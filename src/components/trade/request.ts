import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getOrders, getParentOrder, getParentOrders, getPositions} from "../../http";
import {Actions} from "./intent";

export const request = (actions: Actions): Stream<string | RequestInput | null> => {
    const orders = Stream.periodic(10000).mapTo(getOrders()).startWith(getOrders());
    const parentOrders = Stream.periodic(10000).mapTo(getParentOrders()).startWith(getParentOrders());
    const positions = Stream.periodic(10000).mapTo(getPositions()).startWith(getPositions());

    const ifdocoOrders = actions.onIFDOCOOrdersLoaded$
        .map((os) => Stream.fromArray(os.map((order: any) => getParentOrder(order.parent_order_id))))
        .flatten();

    return Stream.merge(
        orders,
        parentOrders,
        positions,
        ifdocoOrders,
    ) as Stream<string | RequestInput | null>;
};
