import {Response, ResponseStream} from "@cycle/http";
import {MemoryStream, Stream} from "xstream";
import {isCurrentAccountRequest} from "../../../drivers/httpDriver";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

export const createHistoryStream = (name: string, stream$: HTTPResponse$): Stream<OrderHistory> =>
    stream$
        .mapTo("success")
        .replaceError(() => Stream.of("failed"))
        .filter(() => isCurrentAccountRequest(stream$.request))
        .map((status) => childOrderHistory(name, stream$.request.send as string, status));

export const createParentOrderHistoryStream = (stream$: HTTPResponse$): Stream<OrderHistory> =>
    stream$
        .mapTo("success")
        .replaceError(() => Stream.of("failed"))
        .filter(() => isCurrentAccountRequest(stream$.request))
        .map((status) => parentOrderHistories(stream$.request.send as string, status))
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
