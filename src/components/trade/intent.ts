import {RequestOptions} from "@cycle/http";
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

    const onPositionsLoaded$ = pollResponse(positionsResponses$, (json, response) =>
        isCurrent(response) && isPositionList(json) ? {
            position: new Position(json),
            positionCredentialVersion: (response.request as AccountRequest).credentialVersion!,
            positionCloseId: (response.request as PositionRequest).positionCloseId,
        } : undefined);

    // Only a transport error or unparsable body means the account's actual position is unknown;
    // a stale credential or a well-formed-but-unexpected shape is just a response pollResponse
    // silently ignores, so it must not mark the still-valid snapshot as stale.
    const onPositionsRefreshFailed$ = positionsResponses$
        .map((response$) => response$
            .map((response) => {
                try {
                    JSON.parse(response.text);
                    return false;
                } catch {
                    return true;
                }
            })
            .replaceError(() => Stream.of(true)))
        .compose(flattenConcurrently)
        .filter(Boolean)
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
