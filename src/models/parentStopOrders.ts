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

export const retainActive = (parentStopOrders: ParentStopOrders, activeParentOrders: { parent_order_id: string }[]): ParentStopOrders => {
    const retained: ParentStopOrders = Object.create(null);
    let added = false;
    activeParentOrders.forEach(({ parent_order_id: id }) => {
        const detail = Object.prototype.hasOwnProperty.call(parentStopOrders, id) ? parentStopOrders[id] : undefined;
        retained[id] = detail ?? [];
        added ||= detail === undefined;
    });
    return !added && Object.keys(retained).length === Object.keys(parentStopOrders).length
        ? parentStopOrders
        : { ...retained };
};

export const flattenStopOrders = (parentStopOrders: ParentStopOrders): StopOrder[] => {
    const cached = flattenedStopOrders.get(parentStopOrders);
    if (cached) { return cached; }

    const orders: StopOrder[] = [];
    Object.keys(parentStopOrders).forEach((id) => {
        parentStopOrders[id].forEach((order) => orders.push(order));
    });
    flattenedStopOrders.set(parentStopOrders, orders);
    return orders;
};

const flattenedStopOrders = new WeakMap<ParentStopOrders, StopOrder[]>();
