import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getOrders, getParentOrder, getParentOrders, getPositions} from "../../http";
import {Actions} from "./intent";

export const request = (actions: Actions): Stream<string | RequestInput | null> => {
    const orders = Stream.periodic(10000).startWith(0).map(getOrders);
    const parentOrders = Stream.periodic(10000).startWith(0).map(getParentOrders);
    const positions = Stream.periodic(10000).startWith(0).map(getPositions);

    const refreshes = actions.onMyOrderChanged$
        .map((_) => Stream.fromArray([getOrders(), getParentOrders(), getPositions()]))
        .flatten();

    const parentOrderDetails = actions.onParentOrdersLoaded$
        .map((os) => Stream.fromArray(os.map((order: any) => getParentOrder(order.parent_order_id))))
        .flatten();

    return Stream.merge(
        orders,
        parentOrders,
        positions,
        refreshes,
        parentOrderDetails,
    ) as Stream<string | RequestInput | null>;
};
