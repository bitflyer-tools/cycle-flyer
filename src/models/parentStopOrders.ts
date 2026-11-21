import {StopOrder} from "./stopOrder";

export interface ParentStopOrders {
    [parentOrderId: string]: StopOrder[];
}

export const stopOrdersOf = (parentOrder: any): StopOrder[] =>
    (parentOrder.parameters || [])
        .filter((parameter: any) => parameter.condition_type === "STOP" || parameter.condition_type === "STOP_LIMIT")
        .map((parameter: any) => new StopOrder(parameter));

export const putParentOrder = (parentStopOrders: ParentStopOrders, parentOrder: any): ParentStopOrders =>
    Object.prototype.hasOwnProperty.call(parentStopOrders, parentOrder.parent_order_id)
        ? { ...parentStopOrders, [parentOrder.parent_order_id]: stopOrdersOf(parentOrder) }
        : parentStopOrders;

export const retainActive = (parentStopOrders: ParentStopOrders, activeParentOrders: { parent_order_id: string }[]): ParentStopOrders =>
    activeParentOrders
        .map((order) => order.parent_order_id)
        .reduce((acc: ParentStopOrders, id: string) => ({ ...acc, [id]: parentStopOrders[id] || [] }), {});

export const flattenStopOrders = (parentStopOrders: ParentStopOrders): StopOrder[] => {
    const cached = flattenedStopOrders.get(parentStopOrders);
    if (cached) { return cached; }

    const orders = Object.keys(parentStopOrders).reduce((acc: StopOrder[], id) => acc.concat(parentStopOrders[id]), []);
    flattenedStopOrders.set(parentStopOrders, orders);
    return orders;
};

const flattenedStopOrders = new WeakMap<ParentStopOrders, StopOrder[]>();
