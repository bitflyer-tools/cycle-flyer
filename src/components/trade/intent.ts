import {Stream} from "xstream";
import {Position} from "../../models/position";
import {Sources} from "./index";

export interface Actions {
    onExecutionCreated$: Stream<object>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<object>;
    onParentOrdersLoaded$: Stream<object[]>;
    onPositionsLoaded$: Stream<Position>;
}

export const intent = (sources: Sources): Actions => {
    const onExecutionCreated$ = sources.socket.execution$;

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

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text))
        .map((positions) => new Position(positions));

    return {
        onExecutionCreated$,
        onOrdersLoaded$,
        onParentOrderLoaded$,
        onParentOrdersLoaded$,
        onPositionsLoaded$,
    };
};
