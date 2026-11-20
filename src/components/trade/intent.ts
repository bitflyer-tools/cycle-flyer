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

export interface Actions {
    onCancelParentOrder$: Stream<{ id: string; sequence: number }>;
    onExecutionBatch$: Stream<Execution[]>;
    onMyExecutionCreated$: Stream<ChildOrderEvent>;
    onMyOrderChanged$: Stream<null>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<ActiveParentOrder>;
    onParentOrdersLoaded$: Stream<{ orders: ActiveParentOrder[]; sequence: number }>;
    onParentOrderListSettled$: Stream<null>;
    parentOrderRequests$: Stream<RequestOptions>;
    onPositionsLoaded$: Stream<Position>;
}

// Trade state survives navigation, so request and cancellation ordering must survive it too.
let parentOrderSequence = 0;

export const intent = (sources: Sources): Actions => {
    const onCancelParentOrder$ = sources.HTTP.select("cancel-parent-order")
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

    const onOrdersLoaded$ = sources.HTTP.select("orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text));

    const pages = parentOrderPages(sources.HTTP, () => ++parentOrderSequence);
    const onParentOrdersLoaded$ = pages.loaded$;

    const details = parentOrderDetails(
        sources.HTTP, onParentOrdersLoaded$.map(({ orders }) => orders),
        sources.socket.parentOrderEvent$, sources.socket.reconnect$,
    );

    const onPositionsLoaded$ = pollResponse(sources.HTTP.select("positions"), (json) =>
        isPositionList(json) ? new Position(json) : undefined);

    return {
        onCancelParentOrder$,
        onExecutionBatch$: sources.socket.executionBatch$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$,
        onParentOrderLoaded$: details.loaded$,
        onParentOrdersLoaded$,
        onParentOrderListSettled$: pages.settled$,
        onPositionsLoaded$,
        parentOrderRequests$: Stream.merge(pages.requests$, details.requests$),
    };
};

const isPositionList = (positions: unknown): boolean =>
    Array.isArray(positions) && positions.every((position) =>
        (position?.side === "BUY" || position?.side === "SELL")
        && Number.isFinite(position.price) && Number.isFinite(position.size) && position.size > 0);
