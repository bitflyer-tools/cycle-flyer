import {DOMSource, MainDOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {SocketIOSource} from "../../drivers/socketIODriver";
import {Sound} from "../../drivers/soundDriver";
import {Order} from "../../models/order";
import {OrderHistory, prependOrderHistories} from "../../models/orderHistory";
import {flattenStopOrders, ParentStopOrders} from "../../models/parentStopOrders";
import {Position} from "../../models/position";
import {BoardComponent, State as BoardComponentState} from "./board/index";
import {cancellationReducer} from "./cancellation";
import {ExecutionsComponent, State as ExecutionsComponentState} from "./executions";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {OrderComponent, State as OrderComponentState} from "./order";
import {cancellationOutcomes, submittedOrderOutcomes, twapOutcomes} from "./order/history";
import {withMarketFillPreview} from "./order/marketFillPreview";
import {closePositionOutcomes, submissions, unsignedSubmissions$} from "./order/request";
import {recentTrades} from "./recentTrades";
import {request} from "./request";
import {State as SummaryComponentState} from "./summary";
import {SummaryComponent} from "./summary";
import {view} from "./view";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    orderRequests: HTTPSource;
    state: StateSource<State>;
    router: RouterSource;
    socket: SocketIOSource;
    storage: StorageSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    state: Stream<Reducer<State>>;
    router: Stream<void>;
    storage: Stream<StorageRequest>;
    sound?: Stream<Sound>;
}

export interface State {
    canceledParentOrderIds?: ReadonlyMap<string, number>;
    currentPrice: number | null;
    histories: readonly OrderHistory[];
    orders: Order[];
    orderSigningError?: string;
    parentStopOrders: ParentStopOrders;
    position: Position;
    positionCredentialVersion?: number;
    positionClose?: { id: symbol; size: number; settled: boolean; rejected?: boolean };
    price: number;
    boardComponentState?: BoardComponentState;
    executionsComponentState?: ExecutionsComponentState;
    orderComponentState?: OrderComponentState;
    summaryComponentState?: SummaryComponentState;
}

export const Trade = (
    sources: Sources, leaveTrade$?: Stream<void>,
): Sinks & {
    orderRequests: Stream<RequestInput | null>;
} => {
    const executionsComponent = isolate(ExecutionsComponent, { state: "executionsComponentState" })({
        ...sources,
        DOM: sources.DOM as MainDOMSource,
    });
    const summaryComponent = isolate(SummaryComponent, {
        state: {
            get: (state: State) => state.summaryComponentState && {
                ...state.summaryComponentState,
                currentPrice: state.currentPrice,
                histories: state.histories,
                position: state.position,
            },
            set: (state: State, summaryComponentState: SummaryComponentState) => ({
                ...state,
                summaryComponentState,
            }),
        },
    })(sources);

    const boardComponent = isolate(BoardComponent, {
        state: {
            get: (state: State) => state.boardComponentState && {
                ...state.boardComponentState,
                currentPrice: state.currentPrice ?? 0,
                orders: state.orders,
                position: state.position,
                price: state.price,
                stopOrders: flattenStopOrders(state.parentStopOrders),
            },
            set: (state: State, boardComponentState: BoardComponentState) => ({
                ...state,
                boardComponentState,
                price: boardComponentState.price,
            }),
        },
    })(sources);

    const orderViewInputs$ = sources.state.stream.map((state) => ({
        order: state && orderState(state),
        book: state?.boardComponentState,
    }));
    // Deferred to break the cycle: isOrdering$ below is derived from this component's
    // own orderRequests, so construction must wait until isOrdering$ is assigned.
    const orderComponent$ = Stream.of(null).map(() => isolate(OrderComponent, {
        state: {
            get: orderState,
            set: (state: State, orderComponentState: OrderComponentState) => ({
                ...state,
                histories: orderComponentState.histories,
                orderComponentState,
                orders: orderComponentState.orders,
                price: orderComponentState.price,
            }),
        },
    })(sources, isOrdering$, leaveTrade$, withMarketFillPreview(orderViewInputs$))).remember();

    const orderComponentDOM$ = orderComponent$.map((orderComponent) => orderComponent.DOM).flatten();
    const orderComponentHTTP$ = orderComponent$.map((orderComponent) => orderComponent.HTTP).flatten();
    const orderComponentState$ = orderComponent$.map((orderComponent) => orderComponent.state).flatten();
    const orderComponentStorage$ = orderComponent$.map((orderComponent) => orderComponent.storage).flatten();
    const orderRequests$ = orderComponent$.map((orderComponent) => orderComponent.orderRequests).flatten();

    const pending$ = submissions(orderRequests$, sources.orderRequests);
    const isOrdering$ = pending$.map((pending) => pending !== null);

    const positionCloseReducer$ = pending$.map((pending) => (state: State | undefined) => {
        if (!state) return state;

        const submission = pending?.find(({ closePositionSize }) => closePositionSize !== undefined);
        if (submission?.closePositionSize !== undefined) {
            return { ...state, positionClose: {
                id: submission.submissionId, size: submission.closePositionSize, settled: false,
            } };
        }
        return state;
    });
    const closeOutcomeReducer$ = closePositionOutcomes(sources.orderRequests)
        .map(({ id, rejected }) => (state: State | undefined) => {
            const close = state?.positionClose;
            if (!close || close.id !== id || close.settled) return state;
            return { ...state, positionClose: { ...close, settled: true, rejected } };
        });
    const orderSigningError$ = Stream.merge(
        pending$.filter((pending) => pending !== null).mapTo(undefined),
        unsignedSubmissions$.map(({ category }) => (category === "cancel-orders" || category === "cancel-parent-order")
            ? "Could not sign the request to clear orders. Check your bitFlyer credentials in Settings."
            : "Could not sign the order. Check your bitFlyer credentials in Settings."),
    );
    const orderSigningReducer$ = orderSigningError$.map<Reducer<State>>((orderSigningError) =>
        (state) => state && { ...state, orderSigningError });
    const cancellationOutcome$ = cancellationOutcomes(sources.orderRequests);
    const orderOutcome$ = Stream.merge(
        submittedOrderOutcomes(sources.orderRequests),
        twapOutcomes(sources.orderRequests),
        cancellationOutcome$,
    );
    const orderOutcomeReducer$ = orderOutcome$
        .map<Reducer<State>>((outcome) => {
            const reconcile = "parentOrderId" in outcome ? cancellationReducer(outcome) : undefined;
            return (state) => state && {
                ...(reconcile?.(state) ?? state),
                histories: prependOrderHistories(state.histories, outcome.histories),
            };
        });

    const actions = intent(sources, cancellationOutcome$);
    const reducer$ = model(actions);
    const marketTrades = recentTrades(sources, leaveTrade$);
    const view$ = view(boardComponent.DOM, summaryComponent.DOM, orderComponentDOM$, executionsComponent.DOM,
        marketTrades.DOM);
    const settledCloseId$ = sources.state.stream
        .map((state) => state?.positionClose?.settled ? state.positionClose.id : undefined)
        .startWith(undefined)
        .compose(dropRepeats())
        .remember();
    const request$ = request(actions, settledCloseId$);
    const pendingRequests$ = pending$.filter((pending) => pending !== null)
        .map((pending) => Stream.fromArray<RequestInput | null>(pending))
        .compose(flattenConcurrently);

    return {
        DOM: view$,
        HTTP: Stream.merge(request$, boardComponent.HTTP, summaryComponent.HTTP, orderComponentHTTP$,
            executionsComponent.HTTP, marketTrades.HTTP),
        orderRequests: pendingRequests$,
        router: Stream.never(),
        sound: Stream.merge(
            actions.onMyExecutionCreated$.mapTo<Sound>("execution"),
            summaryComponent.sound || Stream.never(),
            orderOutcome$.map(({ status }): Sound => status === "success" ? "success" : "failure"),
        ),
        state: Stream.merge(
            reducer$,
            boardComponent.state,
            executionsComponent.state,
            summaryComponent.state,
            orderComponentState$,
            positionCloseReducer$,
            closeOutcomeReducer$,
            orderSigningReducer$,
            orderOutcomeReducer$,
        ) as Stream<Reducer<State>>,
        storage: Stream.merge(boardComponent.storage, orderComponentStorage$),
    };
};

const orderState = (state: State): OrderComponentState | undefined =>
    state.orderComponentState && {
        ...state.orderComponentState,
        currentPrice: state.currentPrice ?? 0,
        histories: state.histories,
        orders: state.orders,
        orderSigningError: state.orderSigningError,
        positionCredentialVersion: state.positionCredentialVersion,
        parentStopOrders: state.parentStopOrders,
        position: state.position,
        price: state.price,
        positionClosePending: !!state.positionClose,
    };
