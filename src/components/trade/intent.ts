import {RequestOptions} from "@cycle/http";
import {Stream} from "xstream";
import debounce from "xstream/extra/debounce";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {Execution} from "../../models/execution";
import {ChildOrderEvent, isExecution} from "../../models/orderEvent";
import {Position} from "../../models/position";
import {Sources} from "./index";
import {ActiveParentOrder, parentOrderDetails} from "./parentOrderDetails";
import {pollResponse} from "./pollResponse";
import {privateResponses} from "./privateResponses";

export interface Actions {
    onCancelParentOrder$: Stream<{ id: string; sequence: number }>;
    onExecutionBatch$: Stream<Execution[]>;
    onMyExecutionCreated$: Stream<ChildOrderEvent>;
    onMyOrderChanged$: Stream<null>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<ActiveParentOrder>;
    onParentOrdersLoaded$: Stream<{ orders: ActiveParentOrder[]; sequence: number }>;
    parentOrderRequests$: Stream<RequestOptions>;
    onPositionsLoaded$: Stream<Position>;
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

    const onOrdersLoaded$ = privateResponses(sources.HTTP, "orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text));

    const onParentOrdersLoaded$ = privateResponses(sources.HTTP, "parent-orders")
        .map((response$) => {
            const sequence = ++parentOrderSequence;
            return response$.map((response) => ({ orders: JSON.parse(response.text) as ActiveParentOrder[], sequence }))
                .replaceError(() => Stream.never());
        })
        .flatten();

    const details = parentOrderDetails(
        sources.HTTP, onParentOrdersLoaded$.map(({ orders }) => orders),
        sources.socket.parentOrderEvent$, sources.socket.reconnect$,
    );

    const onPositionsLoaded$ = pollResponse(privateResponses(sources.HTTP, "positions"), (json) =>
        isPositionList(json) ? new Position(json) : undefined);

    return {
        onCancelParentOrder$,
        onExecutionBatch$: sources.socket.executionBatch$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$,
        onParentOrderLoaded$: details.loaded$,
        onParentOrdersLoaded$,
        onPositionsLoaded$,
        parentOrderRequests$: details.requests$,
    };
};

const isPositionList = (positions: unknown): boolean =>
    Array.isArray(positions) && positions.every((position) =>
        (position?.side === "BUY" || position?.side === "SELL")
        && Number.isFinite(position.price) && Number.isFinite(position.size) && position.size > 0);
