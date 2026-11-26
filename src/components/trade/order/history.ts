import {HTTPSource, Response, ResponseStream} from "@cycle/http";
import {MemoryStream, Stream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {isCurrentAccountRequest, isWriteDeadlineError} from "../../../drivers/httpDriver";
import {TwapSliceRequest} from "../../../http";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";
import {AcceptanceIdField, hasOrderAcceptanceId, isOrderRejection} from "./rejection";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

type OrderStatus = "success" | "failed" | "unconfirmed";

export interface OrderOutcome {
    status: OrderStatus;
    histories: OrderHistory[];
}

export interface CancellationOutcome extends OrderOutcome {
    parentOrderId: string | null;
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
    }, "child_order_acceptance_id");

const createParentOrderOutcome = (stream$: HTTPResponse$): Stream<OrderOutcome> =>
    createOutcome(
        stream$,
        (body, status) => JSON.parse(body).parameters.map((order: any) =>
            createOrderHistory(
                orderName(order.condition_type),
                order.side,
                order.size,
                order.price || order.trigger_price,
                status,
            ),
        ),
        "parent_order_acceptance_id",
    );

export const cancellationOutcomes = (http: HTTPSource): Stream<CancellationOutcome> =>
    Stream.merge(
        http.select("cancel-orders"),
        http.select("cancel-parent-order"),
    ).map(createCancellationOutcome).compose(flattenConcurrently);

const createCancellationOutcome = (stream$: HTTPResponse$): Stream<CancellationOutcome> => {
    const parentOrderId: string | null = stream$.request.category === "cancel-parent-order"
        ? JSON.parse(stream$.request.send as string).parent_order_id
        : null;
    return createOutcome(stream$, (_, status) => [{
        createdAt: new Date(),
        description: parentOrderId === null ? "All child orders" : `Parent order ${parentOrderId}`,
        name: "Cancel",
        status,
    }]).map((outcome) => ({ ...outcome, parentOrderId }));
};

const createOutcome = (
    stream$: HTTPResponse$,
    createHistories: (body: string, status: OrderStatus) => OrderHistory[],
    acceptanceIdField?: AcceptanceIdField,
): Stream<OrderOutcome> =>
    stream$
        .last()
        .map<{ status: OrderStatus; timedOut: boolean }>((response) => ({
            status: responseStatus(response, acceptanceIdField),
            timedOut: false,
        }))
        .replaceError((error) => {
            const timedOut = isWriteDeadlineError(error);
            const statusCode = error?.statusCode;
            const hasHTTPError = !!error?.response || (statusCode >= 400 && statusCode < 600);
            const isClosePosition = (stream$.request as { closePositionSize?: number }).closePositionSize !== undefined;
            const rejected = isClosePosition ? isOrderRejection(error?.response) : hasHTTPError;
            const status: OrderStatus = !timedOut && rejected ? "failed" : "unconfirmed";
            return Stream.of({ status, timedOut });
        })
        .filter(() => isCurrentAccountRequest(stream$.request))
        .map(({ status, timedOut }) => {
            const histories = createHistories(stream$.request.send as string, status);
            return { status, histories: timedOut ? histories.map((history) => ({ ...history, timedOut })) : histories };
        });

const responseStatus = (response: Response, acceptanceIdField?: AcceptanceIdField): OrderStatus => {
    if (isOrderRejection(response)) return "failed";
    if (acceptanceIdField && !hasOrderAcceptanceId(response, acceptanceIdField)) return "unconfirmed";
    return "success";
};

const orderNames: { [conditionType: string]: string } = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop",
};

const orderName = (conditionType: string): string => orderNames[conditionType] || "Undefined";
