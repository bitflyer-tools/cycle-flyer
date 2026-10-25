import {Response, ResponseStream} from "@cycle/http";
import {MemoryStream, Stream} from "xstream";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

export const createHistoryStream = (name: string, stream$: HTTPResponse$): Stream<OrderHistory> =>
    stream$
        .map((response: any) => childOrderHistory(name, response.request.send, "success"))
        .replaceError((error) => Stream.of(childOrderHistory(name, error.response.request.send, "failed")));

export const createParentOrderHistoryStream = (stream$: HTTPResponse$): Stream<OrderHistory> =>
    stream$
        .map((response: any) => parentOrderHistories(response.request.send, "success"))
        .replaceError((error: any) => Stream.of(parentOrderHistories(error.response.request.send, "failed")))
        .flatten();

const childOrderHistory = (name: string, body: string, status: string): OrderHistory => {
    const send = JSON.parse(body);
    return createOrderHistory(name, send.side, send.size, send.price, status);
};

const parentOrderHistories = (body: string, status: string): Stream<OrderHistory> => {
    const histories = JSON.parse(body).parameters.map((order: any) =>
        createOrderHistory(
            orderName(order.condition_type),
            order.side,
            order.size,
            order.price || order.trigger_price,
            status,
        ),
    );
    return Stream.fromArray(histories as OrderHistory[]);
};

const orderNames: { [conditionType: string]: string } = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop",
};

const orderName = (conditionType: string): string => orderNames[conditionType] || "Undefined";
