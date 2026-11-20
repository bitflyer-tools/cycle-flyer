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
import {closePositionOutcomes, OrderRequestBatch, submissions} from "./trade/order/request";

interface RootState {
    trade?: TradeState;
}

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
    const trade = isolate(Trade, { "*": tradeScope });
    const routes$: Stream<Sinks & { orderRequests?: Stream<OrderRequestBatch> }> = sources.router
        .define({
            "/": trade,
            "/setting": isolate(Setting, { "*": "setting" }),
        })
        .map((route: any) => {
            const sinks = route.value({
                ...sources,
                // Tag order batches with the same HTTP scopes as the other requests.
                orderRequests: sources.HTTP,
                router: sources.router.path(route.path),
            }, isOrdering$);
            return route.value === trade ? sinks : {
                ...sinks,
                state: sinks.state.startWith(clearTwapProgress),
            };
        })
        .remember();

    const orderRequests$ = routes$.map((sinks) => sinks.orderRequests || Stream.never<OrderRequestBatch>()).flatten();
    const pending$ = submissions(orderRequests$, sources.HTTP);
    const positionCloseReducer$ = pending$.map((pending) => (state: TradeState | undefined) => {
        if (!state) return state;

        const submission = pending?.find(({ closePositionSize }) => closePositionSize !== undefined);
        if (submission?.closePositionSize !== undefined) {
            return { ...state, positionClose: {
                id: submission.submissionId, size: submission.closePositionSize, settled: false,
            } };
        }
        return state;
    });
    const closeOutcomeReducer$ = closePositionOutcomes(sources.HTTP)
        .map(({ id, rejected }) => (state: TradeState | undefined) => {
            const close = state?.positionClose;
            if (!close || close.id !== id || close.settled) return state;
            return { ...state, positionClose: { ...close, settled: true, rejected } };
        });
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
            pending$.filter((pending) => pending !== null)
                .map((pending) => Stream.fromArray<RequestInput | null>(pending))
                .compose(flattenConcurrently),
        ),
        router: routes$.map((sinks: Sinks) => sinks.router).flatten(),
        sound: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.sound || Stream.never()).flatten(),
            ifdocoOutcome$.map(({ status }): Sound => status === "success" ? "success" : "failure"),
        ),
        state: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.state).flatten(),
            sources.state.isolateSink(positionCloseReducer$, tradeScope),
            sources.state.isolateSink(closeOutcomeReducer$, tradeScope),
            sources.state.isolateSink(ifdocoHistoryReducer$, tradeScope),
        ),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};

const clearTwapProgress: Reducer<RootState> = (state) => {
    const trade = state?.trade;
    const order = trade?.orderComponentState;
    if (!trade || !order?.twap.remaining) return state;

    return {
        ...state,
        trade: {
            ...trade,
            orderComponentState: { ...order, twap: { ...order.twap, remaining: 0, scheduleId: undefined } },
        },
    };
};
