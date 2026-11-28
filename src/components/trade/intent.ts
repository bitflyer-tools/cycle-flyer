import {RequestOptions, Response} from "@cycle/http";
import {Stream} from "xstream";
import debounce from "xstream/extra/debounce";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {AccountRequest, isCurrentAccountRequest} from "../../drivers/httpDriver";
import {Execution} from "../../models/execution";
import {ChildOrderEvent, isExecution} from "../../models/orderEvent";
import {Position} from "../../models/position";
import {nextParentOrderSequence} from "./cancellation";
import {Sources} from "./index";
import {CancellationOutcome} from "./order/history";
import {ActiveParentOrder, parentOrderDetails} from "./parentOrderDetails";
import {parentOrderPages} from "./parentOrderPages";
import {pollResponse} from "./pollResponse";
import {PositionRequest} from "./request";

interface PositionPollResult {
    position: Position;
    positionCredentialVersion: number;
    positionCloseId: symbol | undefined;
}

interface PositionPollOutcome {
    result?: PositionPollResult;
    failed: boolean;
}

export interface Actions {
    onCancelOrders$: Stream<null>;
    onExecutionBatch$: Stream<Execution[]>;
    onMyExecutionCreated$: Stream<ChildOrderEvent>;
    onMyOrderChanged$: Stream<null>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<ActiveParentOrder>;
    onParentOrdersLoaded$: Stream<{ orders: ActiveParentOrder[]; sequence: number }>;
    onParentOrderListSettled$: Stream<null>;
    parentOrderRequests$: Stream<RequestOptions>;
    onPositionsLoaded$: Stream<{ position: Position; positionCredentialVersion: number; positionCloseId: symbol | undefined }>;
    onPositionsRefreshFailed$: Stream<null>;
}

export const intent = (sources: Sources, cancellationOutcome$ = Stream.never<CancellationOutcome>()): Actions => {
    const isCurrent = (response: { request: AccountRequest }) => isCurrentAccountRequest(response.request);

    const onMyExecutionCreated$ = sources.socket.childOrderEvent$.filter(isExecution);

    const onMyOrderChanged$ = Stream.merge(
        sources.socket.childOrderEvent$.mapTo(null),
        sources.socket.parentOrderEvent$.mapTo(null),
        sources.socket.reconnect$,
    ).compose(debounce(500));

    // Invalidate pending polls before triggering a fresh list. Root clears the retained orders.
    const ordersCanceled = Symbol("ordersCanceled");
    const cancelOrders$ = cancellationOutcome$
        .filter(({ status, parentOrderId }) => status === "success" && parentOrderId === null)
        .mapTo<object[] | typeof ordersCanceled>(ordersCanceled);

    const orderLists$ = pollResponse<object[] | typeof ordersCanceled>(
        sources.HTTP.select("orders"),
        (json, response) => isCurrent(response) ? decodeOrders(json) : undefined,
        cancelOrders$,
    );

    const pages = parentOrderPages(sources.HTTP, nextParentOrderSequence);
    const onParentOrdersLoaded$ = pages.loaded$;

    const details = parentOrderDetails(
        sources.HTTP, onParentOrdersLoaded$.map(({ orders }) => orders),
        sources.socket.parentOrderEvent$, sources.socket.reconnect$,
    );

    const positionsResponses$ = sources.HTTP.select("positions");

    const decodePositions = (response: Response): PositionPollOutcome => {
        let json: unknown;
        try {
            json = JSON.parse(response.text);
        } catch {
            return { failed: true };
        }
        if (!isCurrent(response) || !isPositionList(json)) { return { failed: false }; }
        return {
            failed: false,
            result: {
                position: new Position(json as object[]),
                positionCredentialVersion: (response.request as AccountRequest).credentialVersion!,
                positionCloseId: (response.request as PositionRequest).positionCloseId,
            },
        };
    };

    let nextPositionsRequest = 0;
    let latestAppliedPositionsRequest = 0;

    // A transport error or unparsable body means the account's actual position is unknown and must
    // mark the snapshot stale; a stale credential or a well-formed-but-unexpected shape stays
    // completely invisible here too, exactly like pollResponse, so it never advances the sequence
    // counter below and can't make a still-valid snapshot look stale or superseded. Sharing one
    // request/latestApplied sequence between the success and failure signals (instead of polling the
    // same responses twice, independently) keeps a late failure from an already-superseded poll from
    // overriding a newer snapshot that was already applied.
    const positionsPolled$ = positionsResponses$
        .map((response$) => {
            const request = ++nextPositionsRequest;
            return response$
                .map(decodePositions)
                .replaceError(() => Stream.of<PositionPollOutcome>({ failed: true }))
                .filter((outcome) => outcome.failed || outcome.result !== undefined)
                .map((outcome) => ({ request, outcome }));
        })
        .compose(flattenConcurrently)
        .filter(({ request }) => {
            if (request <= latestAppliedPositionsRequest) { return false; }
            latestAppliedPositionsRequest = request;
            return true;
        })
        .map(({ outcome }) => outcome);

    const onPositionsLoaded$ = positionsPolled$
        .map(({ result }) => result)
        .filter((result): result is PositionPollResult => result !== undefined);

    const onPositionsRefreshFailed$ = positionsPolled$
        .filter(({ failed }) => failed)
        .mapTo(null);

    return {
        onCancelOrders$: orderLists$.filter((orders) => orders === ordersCanceled).mapTo(null),
        onExecutionBatch$: sources.socket.executionBatch$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$: orderLists$.filter((orders): orders is object[] => orders !== ordersCanceled),
        onParentOrderLoaded$: details.loaded$,
        onParentOrdersLoaded$,
        onParentOrderListSettled$: pages.settled$,
        onPositionsLoaded$,
        onPositionsRefreshFailed$,
        parentOrderRequests$: Stream.merge(pages.requests$, details.requests$),
    };
};

const decodeOrders = (json: unknown): object[] | undefined =>
    Array.isArray(json) && json.every((order) =>
        order !== null && typeof order === "object" && !Array.isArray(order)) ? json : undefined;

const isPositionList = (positions: unknown): boolean =>
    Array.isArray(positions) && positions.every((position) =>
        (position?.side === "BUY" || position?.side === "SELL")
        && Number.isFinite(position.price) && Number.isFinite(position.size) && position.size > 0);
