import {a, div, DOMSource, h1, header, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {credentialsChanging$} from "../credentials";
import {SocketIOSource} from "../drivers/socketIODriver";
import {Sound} from "../drivers/soundDriver";
import {OrderHistory} from "../models/orderHistory";
import {Setting} from "./setting";
import {State as TradeState, Trade} from "./trade";
import {createParentOrderHistoryStream} from "./trade/order/history";
import {submissions, unsignedSubmissions$} from "./trade/order/request";
import {twapSigningFailed$} from "./trade/order/twapRequest";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    state: StateSource<object>;
    router: RouterSource;
    socket: SocketIOSource;
    storage: StorageSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    state: Stream<Reducer<any>>;
    router: Stream<any>;
    storage: Stream<StorageRequest>;
    sound?: Stream<Sound>;
}

interface RootState {
    trade?: TradeState;
}

const tradeScope = "trade";

export const Root = (sources: Sources): Sinks => {
    const routes$: Stream<Sinks & { orderRequests?: Stream<RequestInput> }> = sources.router
        .define({
            "/": isolate(Trade, { "*": tradeScope }),
            "/setting": isolate(Setting, { "*": "setting" }),
        })
        .map((route: any) => route.value({
            ...sources,
            // Apply the same HTTP isolation to both request sinks.
            orderRequests: sources.HTTP,
            router: sources.router.path(route.path),
        }, isOrdering$))
        .remember();

    const orderRequests$ = routes$.map((sinks) => sinks.orderRequests || Stream.never<RequestInput>()).flatten();
    const pending$ = submissions(orderRequests$, sources.HTTP);
    const isOrdering$ = pending$.map((pending) => pending !== null);
    const orderSigningError$ = Stream.merge(
        pending$.filter((pending) => pending !== null).mapTo(undefined),
        unsignedSubmissions$.map(({ category }) => category === "cancel-orders"
            ? "Could not sign the request to clear orders. Check your bitFlyer credentials in Settings."
            : "Could not sign the order. Check your bitFlyer credentials in Settings."),
    );
    const orderSigningReducer$ = orderSigningError$.map<Reducer<TradeState>>((orderSigningError) =>
        (state) => state && { ...state, orderSigningError });
    const ifdocoHistories$: Stream<OrderHistory> = sources.HTTP.select("ifdoco-order")
        .map(createParentOrderHistoryStream)
        .compose(flattenConcurrently);
    const ifdocoHistoryReducer$ = ifdocoHistories$
        .map<Reducer<TradeState>>((history) => (state) =>
            state && { ...state, histories: [history].concat(state.histories) });

    const view$ = routes$.map((sinks: Sinks) => sinks.DOM).flatten()
        .map((contentDOM: any) =>
                div("#wrapper", [
                    header(".header", [
                        div(".header-wrapper", [
                            h1(".header-title", "cycle-flyer"),
                            a(".menu-trade", { props: { href: "/" } }, "Trade"),
                            a(".menu-setting", { props: { href: "/setting" } }, "Setting"),
                        ]),
                    ]),
                    div(".content", [contentDOM]),
                ]),
            );

    return {
        DOM: view$,
        HTTP: Stream.merge(
            routes$.map((sinks) => sinks.HTTP).flatten(),
            pending$.filter((pending) => pending !== null).map<RequestInput | null>((pending) => pending),
        ),
        router: routes$.map((sinks: Sinks) => sinks.router).flatten(),
        sound: routes$.map((sinks: Sinks) => sinks.sound || Stream.never()).flatten(),
        state: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.state).flatten(),
            credentialsChanging$.mapTo(resetTwap("TWAP stopped because credentials changed.")),
            twapSigningFailed$.mapTo(resetTwap("TWAP stopped because an order could not be signed.")),
            sources.state.isolateSink(ifdocoHistoryReducer$, tradeScope),
            sources.state.isolateSink(orderSigningReducer$, tradeScope),
        ),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};

const resetTwap = (error: string): Reducer<RootState> => (state) => {
    const trade = state?.trade;
    const order = trade?.orderComponentState;
    if (!trade || !order || !order.twap.remaining) { return state; }
    const orderComponentState = { ...order, twap: { ...order.twap, remaining: 0, error } };
    return { ...state, trade: { ...trade, orderComponentState } };
};
