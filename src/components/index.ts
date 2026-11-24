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
import {prependOrderHistories} from "../models/orderHistory";
import {Position} from "../models/position";
import {Setting} from "./setting";
import {State as TradeState, Trade} from "./trade";
import {cancellationReducer} from "./trade/cancellation";
import {initialState as initialExecutionsState} from "./trade/executions";
import {cancellationOutcomes, submittedOrderOutcomes, twapOutcomes} from "./trade/order/history";
import {closePositionOutcomes, OrderRequestBatch, submissions, unsignedSubmissions$} from "./trade/order/request";

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
    const cancellationOutcome$ = cancellationOutcomes(sources.HTTP);
    const leaveTrade$ = Stream.create<void>();
    const trade = isolate(Trade, { "*": tradeScope });
    const routes$: Stream<Sinks & { orderRequests?: Stream<OrderRequestBatch> }> = sources.router
        .define({
            "/": trade,
            "/setting": isolate(Setting, { "*": "setting" }),
        })
        .map((route: any) => {
            // Cancel while the outgoing Trade reducer is still subscribed.
            if (route.value !== trade) { leaveTrade$.shamefullySendNext(undefined); }
            return route.value({
                ...sources,
                // Tag order batches with the same HTTP scopes as the other requests.
                orderRequests: sources.HTTP,
                router: sources.router.path(route.path),
            }, isOrdering$, leaveTrade$, cancellationOutcome$);
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
    const orderSigningError$ = Stream.merge(
        pending$.filter((pending) => pending !== null).mapTo(undefined),
        unsignedSubmissions$.map(({ category }) => (category === "cancel-orders" || category === "cancel-parent-order")
            ? "Could not sign the request to clear orders. Check your bitFlyer credentials in Settings."
            : "Could not sign the order. Check your bitFlyer credentials in Settings."),
    );
    const orderSigningReducer$ = orderSigningError$.map<Reducer<TradeState>>((orderSigningError) =>
        (state) => state && { ...state, orderSigningError });
    const orderOutcome$ = Stream.merge(
        submittedOrderOutcomes(sources.HTTP),
        twapOutcomes(sources.HTTP),
        cancellationOutcome$,
    );
    const orderOutcomeReducer$ = orderOutcome$
        .map<Reducer<TradeState>>((outcome) => {
            const reconcile = "parentOrderId" in outcome ? cancellationReducer(outcome) : undefined;
            return (state) => state && {
                ...(reconcile?.(state) ?? state),
                histories: prependOrderHistories(state.histories, outcome.histories),
            };
        });

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
            orderOutcome$.map(({ status }): Sound => status === "success" ? "success" : "failure"),
        ),
        state: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.state).flatten(),
            credentialsChanging$.mapTo(resetAccount),
            sources.state.isolateSink(positionCloseReducer$, tradeScope),
            sources.state.isolateSink(closeOutcomeReducer$, tradeScope),
            sources.state.isolateSink(orderOutcomeReducer$, tradeScope),
            sources.state.isolateSink(orderSigningReducer$, tradeScope),
        ),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};

const resetAccount: Reducer<RootState> = (state) => {
    if (!state?.trade) { return state; }
    const {trade} = state;
    return {
        ...state,
        trade: {
            ...trade,
            canceledParentOrderIds: undefined,
            executionsComponentState: initialExecutionsState,
            histories: [],
            orders: [],
            orderSigningError: undefined,
            parentStopOrders: {},
            summaryComponentState: trade.summaryComponentState && {
                ...trade.summaryComponentState,
                collateral: 0,
            },
            orderComponentState: trade.orderComponentState && { ...trade.orderComponentState, isOrdering: false },
            position: new Position([]),
            positionCredentialVersion: undefined,
            positionStale: true,
            positionClose: undefined,
        },
    };
};
