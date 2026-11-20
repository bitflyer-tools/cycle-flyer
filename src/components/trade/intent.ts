import {RequestOptions} from "@cycle/http";
import {Stream} from "xstream";
import debounce from "xstream/extra/debounce";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {Execution} from "../../models/execution";
import {ChildOrderEvent, isExecution} from "../../models/orderEvent";
import {Position} from "../../models/position";
import {Sources} from "./index";
import {ActiveParentOrder, parentOrderDetails} from "./parentOrderDetails";
import {parentOrderPages} from "./parentOrderPages";
import {pollResponse} from "./pollResponse";
import {privateResponses} from "./privateResponses";
import {PositionRequest} from "./request";

export interface Actions {
    onCancelOrders$: Stream<null>;
    onCancelParentOrder$: Stream<{ id: string; sequence: number }>;
    onExecutionBatch$: Stream<Execution[]>;
    onMyExecutionCreated$: Stream<ChildOrderEvent>;
    onMyOrderChanged$: Stream<null>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<ActiveParentOrder>;
    onParentOrdersLoaded$: Stream<{ orders: ActiveParentOrder[]; sequence: number }>;
    onParentOrderListSettled$: Stream<null>;
    parentOrderRequests$: Stream<RequestOptions>;
    onPositionsLoaded$: Stream<{ position: Position; positionCloseId: symbol | undefined }>;
}

// Trade state survives navigation, so request and cancellation ordering must survive it too.
let parentOrderSequence = 0;

export const intent = (sources: Sources): Actions => {
    const onCancelParentOrder$ = privateResponses(sources.HTTP, "cancel-parent-order")
        .map((response$) => response$.replaceError(() => Stream.empty()))
        .compose(flattenConcurrently)
        .map((response) => ({
            id: JSON.parse(response.request.send as string).parent_order_id as string,
            sequence: ++parentOrderSequence,
        }));

    const onMyExecutionCreated$ = sources.socket.childOrderEvent$.filter(isExecution);

    const onMyOrderChanged$ = Stream.merge(
        sources.socket.childOrderEvent$.mapTo(null),
        sources.socket.parentOrderEvent$.mapTo(null),
        sources.socket.reconnect$,
    ).compose(debounce(500));

    const ordersCanceled = Symbol("ordersCanceled");
    const cancelOrders$ = privateResponses(sources.HTTP, "cancel-orders")
        .map((response$) => response$.replaceError(() => Stream.empty()))
        .compose(flattenConcurrently)
        .mapTo<typeof ordersCanceled>(ordersCanceled);

    const orderLists$ = pollResponse<object[] | typeof ordersCanceled>(
        privateResponses(sources.HTTP, "orders"), decodeArray, cancelOrders$,
    );

    const pages = parentOrderPages(sources.HTTP, () => ++parentOrderSequence);
    const onParentOrdersLoaded$ = pages.loaded$;

    const details = parentOrderDetails(
        sources.HTTP, onParentOrdersLoaded$.map(({ orders }) => orders),
        sources.socket.parentOrderEvent$, sources.socket.reconnect$,
    );

    const onPositionsLoaded$ = pollResponse(privateResponses(sources.HTTP, "positions"), (json, request: PositionRequest) =>
        isPositionList(json) ? { position: new Position(json), positionCloseId: request.positionCloseId } : undefined);

    return {
        onCancelOrders$: orderLists$.filter((orders) => orders === ordersCanceled).mapTo(null),
        onCancelParentOrder$,
        onExecutionBatch$: sources.socket.executionBatch$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$: orderLists$.map<object[]>((orders) => orders === ordersCanceled ? [] : orders),
        onParentOrderLoaded$: details.loaded$,
        onParentOrdersLoaded$,
        onParentOrderListSettled$: pages.settled$,
        onPositionsLoaded$,
        parentOrderRequests$: Stream.merge(pages.requests$, details.requests$),
    };
};

const decodeArray = <T>(json: unknown): T[] | undefined => Array.isArray(json) ? json : undefined;

const isPositionList = (positions: unknown): boolean =>
    Array.isArray(positions) && positions.every((position) =>
        (position?.side === "BUY" || position?.side === "SELL")
        && Number.isFinite(position.price) && Number.isFinite(position.size) && position.size > 0);
