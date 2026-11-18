import {Stream} from "xstream";
import debounce from "xstream/extra/debounce";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {ChildOrderEvent, isExecution} from "../../models/orderEvent";
import {Position} from "../../models/position";
import {Sources} from "./index";
import {pollResponse} from "./pollResponse";

export interface Actions {
    onCancelParentOrder$: Stream<string>;
    onExecutionCreated$: Stream<object>;
    onMyExecutionCreated$: Stream<ChildOrderEvent>;
    onMyOrderChanged$: Stream<null>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<{ parent_order_id: string }>;
    onParentOrdersLoaded$: Stream<{ parent_order_id: string }[]>;
    onPositionsLoaded$: Stream<Position>;
}

export const intent = (sources: Sources): Actions => {
    const onCancelParentOrder$ = sources.HTTP.select("cancel-parent-order")
        .map((response$) => response$.replaceError(() => Stream.empty()))
        .compose(flattenConcurrently)
        .map((response) => JSON.parse(response.request.send as string).parent_order_id);

    const onExecutionCreated$ = sources.socket.execution$;

    const onMyExecutionCreated$ = sources.socket.childOrderEvent$.filter(isExecution);

    const onMyOrderChanged$ = Stream.merge(
        sources.socket.childOrderEvent$.mapTo(null),
        sources.socket.parentOrderEvent$.mapTo(null),
    ).compose(debounce(500));

    const onOrdersLoaded$ = sources.HTTP.select("orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text));

    const onParentOrdersLoaded$ = sources.HTTP.select("parent-orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text));

    const onParentOrderLoaded$ = sources.HTTP.select("parent-order")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text));

    const onPositionsLoaded$ = pollResponse(sources.HTTP.select("positions"), (json) =>
        isPositionList(json) ? new Position(json) : undefined);

    return {
        onCancelParentOrder$,
        onExecutionCreated$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$,
        onParentOrderLoaded$,
        onParentOrdersLoaded$,
        onPositionsLoaded$,
    };
};

const isPositionList = (positions: unknown): boolean =>
    Array.isArray(positions) && positions.every((position) =>
        (position?.side === "BUY" || position?.side === "SELL")
        && Number.isFinite(position.price) && Number.isFinite(position.size) && position.size > 0);
