import {HTTPSource, Response, ResponseStream} from "@cycle/http";
import {MemoryStream, Stream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {AccountRequest, isCurrentAccountRequest, isWriteDeadlineError} from "../../../drivers/httpDriver";
import {TwapSliceRequest} from "../../../http";
import {createOrderHistory, OrderHistory} from "../../../models/orderHistory";
import {AcceptanceIdField, hasOrderAcceptanceId, orderRejectionReason} from "./rejection";

type HTTPResponse$ = MemoryStream<Response> & ResponseStream;

type OrderStatus = "success" | "failed" | "unconfirmed";
type OutcomeDetails = { status: OrderStatus } & Pick<OrderHistory, "rejectionReason" | "timedOut">;

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
        .map((response) => responseDetails(response, acceptanceIdField))
        .replaceError((error) => {
            if (isWriteDeadlineError(error)) return Stream.of<OutcomeDetails>({ status: "unconfirmed", timedOut: true });
            const rejectionReason = orderRejectionReason(error?.response);
            const statusCode = error?.statusCode;
            const hasHTTPError = !!error?.response || (statusCode >= 400 && statusCode < 600);
            const isClosePosition = (stream$.request as { closePositionSize?: number }).closePositionSize !== undefined;
            if (rejectionReason) return Stream.of<OutcomeDetails>({ status: "failed", rejectionReason });
            return Stream.of<OutcomeDetails>({ status: !isClosePosition && hasHTTPError ? "failed" : "unconfirmed" });
        })
        .filter(() => isCurrentAccountRequest(stream$.request as AccountRequest))
        .map(({ status, ...details }) => ({
            status,
            histories: createHistories(stream$.request.send as string, status)
                .map((history) => ({ ...history, ...details })),
        }));

const responseDetails = (response: Response, acceptanceIdField?: AcceptanceIdField): OutcomeDetails => {
    const rejectionReason = orderRejectionReason(response);
    if (rejectionReason) return { status: "failed", rejectionReason };
    const accepted = !acceptanceIdField || hasOrderAcceptanceId(response, acceptanceIdField);
    return { status: accepted ? "success" : "unconfirmed" };
};

const orderNames: { [conditionType: string]: string } = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop",
};

const orderName = (conditionType: string): string => orderNames[conditionType] || "Undefined";
