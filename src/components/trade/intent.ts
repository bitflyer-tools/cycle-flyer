import {Stream} from "xstream";
import {Position} from "../../models/position";
import {StopOrder} from "../../models/stopOrder";
import {Sources} from "./index";

export interface Actions {
    onExecutionCreated$: Stream<object>;
    onIFDOCOOrdersLoaded$: Stream<object[]>;
    onOrdersLoaded$: Stream<object[]>;
    onPositionsLoaded$: Stream<Position>;
    onStopOrdersLoaded$: Stream<StopOrder[]>;
}

export const intent = (sources: Sources): Actions => {
    const onExecutionCreated$ = sources.socket.execution$;

    const onIFDOCOOrdersLoaded$ = sources.HTTP.select("parent-orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text))
        .filter((orders) => orders.filter((o: any) => o.parent_order_type === "IFDOCO"));

    const onOrdersLoaded$ = sources.HTTP.select("orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text));

    const onStopOrdersLoaded$ = Stream.combine(
        sources.HTTP.select("parent-orders")
            .map((response$) => response$.replaceError(() => Stream.never()))
            .flatten()
            .map((response) => JSON.parse(response.text))
            .filter((o) => o.parent_order_type === "STOP")
            .map((orders) => orders.map((o: any) => new StopOrder(o)))
            .startWith([]),
        sources.HTTP.select("parent-order")
            .map((response$) => response$.replaceError(() => Stream.never()))
            .flatten()
            .map((response) => JSON.parse(response.text))
            .map((o) => o.parameters.filter((or: any) => or.condition_type === "STOP"))
            .map((orders) => orders.map((o: any) => new StopOrder(o)))
            .startWith([]),
    ).map(([s1, s2]) => s1.concat(s2));

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .map((response) => JSON.parse(response.text))
        .map((positions) => new Position(positions));

    return {
        onExecutionCreated$,
        onIFDOCOOrdersLoaded$,
        onOrdersLoaded$,
        onPositionsLoaded$,
        onStopOrdersLoaded$,
    };
};
