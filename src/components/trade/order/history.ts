import {HTTPSource, Response, ResponseStream} from "@cycle/http";
import {MemoryStream, Stream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {isCurrentAccountRequest, isWriteDeadlineError} from "../../../drivers/httpDriver";
import {TwapSliceRequest} from "../../../http";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";
import {isOrderRejection} from "./rejection";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

type OrderStatus = "success" | "failed" | "unconfirmed";

export interface OrderOutcome {
    status: OrderStatus;
    histories: OrderHistory[];
}

export interface TwapSliceOutcome extends OrderOutcome {
    scheduleId: symbol;
}

export const submittedOrderOutcomes = (http: HTTPSource): Stream<OrderOutcome> =>
    Stream.merge(
        http.select("market-order").map((response$) => createChildOrderOutcome("Market", response$)),
        http.select("limit-order").map((response$) => createChildOrderOutcome("Limit", response$)),
        http.select("stop-order").map(createParentOrderOutcome),
        http.select("ifdoco-order").map(createParentOrderOutcome),
    ).compose(flattenConcurrently);

export const twapOutcomes = (http: HTTPSource): Stream<TwapSliceOutcome> =>
    http.select("twap-order")
        .map((response$) => {
            const {scheduleId} = response$.request as TwapSliceRequest;
            return createChildOrderOutcome("TWAP", response$).map((outcome) => ({ ...outcome, scheduleId }));
        })
        .compose(flattenConcurrently);

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

export const createCancellationOutcome = (stream$: HTTPResponse$): Stream<OrderOutcome> =>
    createOutcome(stream$, (body, status) => [{
        createdAt: new Date(),
        description: stream$.request.category === "cancel-parent-order"
            ? `Parent order ${JSON.parse(body).parent_order_id}`
            : "All child orders",
        name: "Cancel",
        status,
    }]);

const createOutcome = (
    stream$: HTTPResponse$,
    createHistories: (body: string, status: OrderStatus) => OrderHistory[],
): Stream<OrderOutcome> =>
    stream$
        .last()
        .map<OrderStatus>((response) => isOrderRejection(response) ? "failed" : "success")
        .replaceError((error) => Stream.of<OrderStatus>(isWriteDeadlineError(error) ? "unconfirmed" : "failed"))
        .filter(() => isCurrentAccountRequest(stream$.request))
        .map((status) => ({ status, histories: createHistories(stream$.request.send as string, status) }));

const orderNames: { [conditionType: string]: string } = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop",
};

const orderName = (conditionType: string): string => orderNames[conditionType] || "Undefined";
