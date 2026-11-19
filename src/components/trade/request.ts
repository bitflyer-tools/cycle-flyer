import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getOrders, getParentOrders, getPositions, hasApiCredentials} from "../../http";
import {Actions} from "./intent";

export const request = (actions: Actions): Stream<string | RequestInput | null> => {
    const refreshes = Stream.merge(Stream.periodic(10000), actions.onMyOrderChanged$)
        .startWith(null)
        .filter(hasApiCredentials)
        .map(() => Stream.of(getOrders(), getParentOrders(), getPositions()))
        .flatten();

    return Stream.merge(
        refreshes,
        actions.parentOrderRequests$,
    ) as Stream<string | RequestInput | null>;
};
