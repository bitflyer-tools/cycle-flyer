import {RequestOptions} from "@cycle/http";
import {Stream} from "xstream";
import debounce from "xstream/extra/debounce";
import {ChildOrderEvent, isExecution} from "../../models/orderEvent";
import {Position} from "../../models/position";
import {Sources} from "./index";
import {ActiveParentOrder, parentOrderDetails} from "./parentOrderDetails";

export interface Actions {
    onExecutionCreated$: Stream<object>;
    onMyExecutionCreated$: Stream<ChildOrderEvent>;
    onMyOrderChanged$: Stream<null>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<ActiveParentOrder>;
    onParentOrdersLoaded$: Stream<ActiveParentOrder[]>;
    parentOrderRequests$: Stream<RequestOptions>;
    onPositionsLoaded$: Stream<Position>;
}

export const intent = (sources: Sources): Actions => {
    const onExecutionCreated$ = sources.socket.execution$;

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

    const onParentOrdersLoaded$ = sources.HTTP.select("parent-orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text));

    const details = parentOrderDetails(
        sources.HTTP, onParentOrdersLoaded$, sources.socket.parentOrderEvent$, sources.socket.reconnect$,
    );

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text))
        .map((positions) => new Position(positions));

    return {
        onExecutionCreated$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$,
        onParentOrderLoaded$: details.loaded$,
        onParentOrdersLoaded$,
        onPositionsLoaded$,
        parentOrderRequests$: details.requests$,
    };
};
