import {HTTPSource, Response, ResponseStream} from "@cycle/http";
import Stream, {MemoryStream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

type OrderStatus = "success" | "failed";

export interface OrderOutcome {
    status: OrderStatus;
    histories: OrderHistory[];
}

export const submittedOrderOutcomes = (http: HTTPSource): Stream<OrderOutcome> =>
    Stream.merge(
        http.select("market-order").map((response$) => createChildOrderOutcome("Market", response$)),
        http.select("limit-order").map((response$) => createChildOrderOutcome("Limit", response$)),
        http.select("stop-order").map(createParentOrderOutcome),
        http.select("ifdoco-order").map(createParentOrderOutcome),
    ).compose(flattenConcurrently);

export const createChildOrderOutcome = (name: string, stream$: HTTPResponse$): Stream<OrderOutcome> =>
    createOutcome(stream$, (body, status) => {
        const send = JSON.parse(body);
        return [createOrderHistory(name, send.side, send.size, send.price, status)];
    });

const createParentOrderOutcome = (stream$: HTTPResponse$): Stream<OrderOutcome> =>
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
        .replaceError(() => Stream.of<OrderStatus>("failed"))
        .map((status) => ({ status, histories: createHistories(stream$.request.send as string, status) }));

const orderNames: { [conditionType: string]: string } = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop",
};

const orderName = (conditionType: string): string => orderNames[conditionType] || "Undefined";
