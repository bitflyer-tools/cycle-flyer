import {a, div, DOMSource, h1, header, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {SocketIOSource} from "../drivers/socketIODriver";
import {Sound} from "../drivers/soundDriver";
import {Setting} from "./setting";
import {State as TradeState, Trade} from "./trade";
import {createParentOrderOutcome} from "./trade/order/history";
import {submissions} from "./trade/order/request";

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
    const ifdocoOutcome$ = sources.HTTP.select("ifdoco-order")
        .map(createParentOrderOutcome)
        .compose(flattenConcurrently);
    const ifdocoHistoryReducer$ = ifdocoOutcome$
        .map(({ histories }) => (state: TradeState) => ({
            ...state,
            histories: histories.slice().reverse().concat(state.histories),
        }));

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
        sound: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.sound || Stream.never()).flatten(),
            ifdocoOutcome$.map(({ status }): Sound => status === "success" ? "success" : "failure"),
        ),
        state: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.state).flatten(),
            sources.state.isolateSink(ifdocoHistoryReducer$, tradeScope),
        ),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};
