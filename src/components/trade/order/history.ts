import {Response, ResponseStream} from "@cycle/http";
import {MemoryStream, Stream} from "xstream";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

type OrderStatus = "success" | "failed" | "unconfirmed";

export interface OrderOutcome {
    status: OrderStatus;
    histories: OrderHistory[];
}

export const createChildOrderOutcome = (name: string, stream$: HTTPResponse$): Stream<OrderOutcome> =>
    createOutcome(stream$, (body, status) => {
        const send = JSON.parse(body);
        return [createOrderHistory(name, send.side, send.size, send.price, status)];
    });

export const createParentOrderOutcome = (stream$: HTTPResponse$): Stream<OrderOutcome> =>
    createOutcome(stream$, (body, status) =>
        JSON.parse(body).parameters.map((order: any) =>
            createOrderHistory(
                orderName(order.condition_type),
                order.side,
                order.size,
                order.price || order.trigger_price,
                status,
            ),
        ),
    );

const createOutcome = (
    stream$: HTTPResponse$,
    createHistories: (body: string, status: OrderStatus) => OrderHistory[],
): Stream<OrderOutcome> =>
    stream$
        .last()
        .mapTo<OrderStatus>("success")
        .replaceError((error) => Stream.of<OrderStatus>(error?.response ? "failed" : "unconfirmed"))
        .map((status) => ({ status, histories: createHistories(stream$.request.send as string, status) }));

const orderNames: { [conditionType: string]: string } = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop",
};

const orderName = (conditionType: string): string => orderNames[conditionType] || "Undefined";
