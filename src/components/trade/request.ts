import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getOrders, getParentOrders, getPositions} from "../../http";
import {Actions} from "./intent";

export const request = (actions: Actions): Stream<string | RequestInput | null> => {
    const orders = Stream.periodic(10000).mapTo(getOrders()).startWith(getOrders());
    const parentOrders = Stream.periodic(10000).map(getParentOrders).startWith(getParentOrders());
    const positions = Stream.periodic(10000).mapTo(getPositions()).startWith(getPositions());

    const refreshes = actions.onMyOrderChanged$
        .map((_) => Stream.fromArray([getOrders(), getParentOrders(), getPositions()]))
        .flatten();

    return Stream.merge(
        orders,
        parentOrders,
        positions,
        refreshes,
        actions.parentOrderRequests$,
    ) as Stream<string | RequestInput | null>;
};
