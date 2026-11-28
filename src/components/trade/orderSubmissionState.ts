import {HTTPSource, RequestInput} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {credentialsChanging$} from "../../credentials";
import {Sound} from "../../drivers/soundDriver";
import {prependOrderHistories} from "../../models/orderHistory";
import {Position} from "../../models/position";
import {cancellationReducer} from "./cancellation";
import {initialState as initialExecutionsState} from "./executions";
import type {State} from "./index";
import {cancellationOutcomes, submittedOrderOutcomes, twapOutcomes} from "./order/history";
import {closePositionOutcomes, OrderRequestBatch, submissions, unsignedSubmissions$} from "./order/request";

export interface OrderSubmissionState {
    isOrdering$: Stream<boolean>;
    orderRequests$: Stream<RequestInput | null>;
    reducer$: Stream<Reducer<State>>;
    sound$: Stream<Sound>;
    submit: (batch: OrderRequestBatch) => void;
}

// Trade is torn down and rebuilt on every navigation away from and back to "/" (it isn't a
// long-lived singleton like Root is), so this orchestration is built once per Root() call —
// Root creates a single instance and passes it down to every Trade() invocation for the
// lifetime of the app — rather than being rebuilt inside Trade() itself. Otherwise an order
// submitted just before leaving for Settings would lose its outcome tracking (isOrdering/
// orderSigningError/positionClose/histories) the moment Trade unmounts.
export const createOrderSubmissionState = (http: HTTPSource): OrderSubmissionState => {
    const submissionBatchSignal$ = Stream.create<OrderRequestBatch>();
    const pending$ = submissions(submissionBatchSignal$, http);
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
    const closeOutcomeReducer$ = closePositionOutcomes(http)
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
    const orderOutcome$ = Stream.merge(
        submittedOrderOutcomes(http),
        twapOutcomes(http),
        cancellationOutcomes(http),
    );
    const orderOutcomeReducer$ = orderOutcome$
        .map<Reducer<State>>((outcome) => {
            const reconcile = "parentOrderId" in outcome ? cancellationReducer(outcome) : undefined;
            return (state) => state && {
                ...(reconcile?.(state) ?? state),
                histories: prependOrderHistories(state.histories, outcome.histories),
            };
        });

    const orderRequests$ = pending$.filter((pending) => pending !== null)
        .map((pending) => Stream.fromArray<RequestInput | null>(pending))
        .compose(flattenConcurrently);

    // Must stay here rather than in Trade's own model: a credential change while on Settings
    // (Trade unmounted) would otherwise never be observed, leaving the previous account's
    // executions/position/histories visible when Trade remounts.
    const resetAccountReducer$ = credentialsChanging$.mapTo(resetAccount);

    const reducer$ = Stream.merge(
        positionCloseReducer$,
        closeOutcomeReducer$,
        orderSigningReducer$,
        orderOutcomeReducer$,
        resetAccountReducer$,
    ) as Stream<Reducer<State>>;
    const sound$ = orderOutcome$.map((outcome): Sound => outcome.status === "success" ? "success" : "failure");

    // Keep every stage hot forever, independent of whether Trade (or Root) currently has a
    // listener attached, so submissions are tracked and reconciled even while on Settings.
    reducer$.addListener({});
    sound$.addListener({});
    isOrdering$.addListener({});

    return {
        isOrdering$,
        orderRequests$,
        reducer$,
        sound$,
        submit: (batch) => submissionBatchSignal$.shamefullySendNext(batch),
    };
};

const resetAccount: Reducer<State> = (state) => state && {
    ...state,
    canceledParentOrderIds: undefined,
    executionsComponentState: initialExecutionsState,
    histories: [],
    orders: [],
    orderSigningError: undefined,
    parentStopOrders: {},
    summaryComponentState: state.summaryComponentState && { ...state.summaryComponentState, collateral: 0 },
    orderComponentState: state.orderComponentState && { ...state.orderComponentState, isOrdering: false },
    position: new Position([]),
    positionCredentialVersion: undefined,
    positionClose: undefined,
};
