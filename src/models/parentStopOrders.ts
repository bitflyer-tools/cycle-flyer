import {StopOrder} from "./stopOrder";

export interface ParentStopOrders {
    [parentOrderId: string]: StopOrder[];
}

export const stopOrdersOf = (parentOrder: any): StopOrder[] =>
    (parentOrder.parameters || [])
        .filter((parameter: any) => parameter.condition_type === "STOP")
        .map((parameter: any) => new StopOrder(parameter));

export const putParentOrder = (parentStopOrders: ParentStopOrders, parentOrder: any): ParentStopOrders =>
    ({ ...parentStopOrders, [parentOrder.parent_order_id]: stopOrdersOf(parentOrder) });

export const retainActive = (parentStopOrders: ParentStopOrders, activeParentOrders: any[]): ParentStopOrders =>
    activeParentOrders
        .map((order) => order.parent_order_id)
        .filter((id: string) => !!parentStopOrders[id])
        .reduce((acc: ParentStopOrders, id: string) => ({ ...acc, [id]: parentStopOrders[id] }), {});

export const flattenStopOrders = (parentStopOrders: ParentStopOrders): StopOrder[] =>
    Object.keys(parentStopOrders).reduce((acc: StopOrder[], id) => acc.concat(parentStopOrders[id]), []);
