import {HTTPSource, Response, ResponseStream} from "@cycle/http";
import {MemoryStream, Stream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {isWriteDeadlineError} from "../../../drivers/httpDriver";
import {TwapSliceRequest} from "../../../http";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

type OrderStatus = "success" | "failed" | "unconfirmed";

export interface OrderOutcome {
    status: OrderStatus;
    histories: OrderHistory[];
}

export interface TwapSliceOutcome extends OrderOutcome {
    scheduleId: symbol;
}

export const orderOutcomes = (http: HTTPSource): Stream<OrderOutcome> =>
    Stream.merge(
        http.select("market-order").map((response$) => createChildOrderOutcome("Market", response$)),
        http.select("limit-order").map((response$) => createChildOrderOutcome("Limit", response$)),
        http.select("stop-order").map(createParentOrderOutcome),
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

export const createCancellationTimeoutHistory = (stream$: HTTPResponse$): Stream<OrderHistory> =>
    stream$.mapTo<OrderHistory | null>(null)
        .replaceError((error) => {
            if (!isWriteDeadlineError(error)) return Stream.empty();
            const parentOrderId = JSON.parse(stream$.request.send as string).parent_order_id;
            return Stream.of<OrderHistory | null>({
                createdAt: new Date(),
                description: parentOrderId || "All child orders",
                name: "Cancel",
                status: "unconfirmed",
                timedOut: true,
            });
        })
        .filter((history): history is OrderHistory => history !== null);

const createOutcome = (
    stream$: HTTPResponse$,
    createHistories: (body: string, status: OrderStatus) => OrderHistory[],
): Stream<OrderOutcome> =>
    stream$
        .last()
        .mapTo<{ status: OrderStatus; timedOut: boolean }>({ status: "success", timedOut: false })
        .replaceError((error) => {
            const timedOut = isWriteDeadlineError(error);
            const status: OrderStatus = timedOut || !error?.response ? "unconfirmed" : "failed";
            return Stream.of({ status, timedOut });
        })
        .map(({ status, timedOut }) => {
            const histories = createHistories(stream$.request.send as string, status);
            return { status, histories: timedOut ? histories.map((history) => ({ ...history, timedOut })) : histories };
        });

const orderNames: { [conditionType: string]: string } = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop",
};

const orderName = (conditionType: string): string => orderNames[conditionType] || "Undefined";
