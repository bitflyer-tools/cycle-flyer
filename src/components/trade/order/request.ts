import {HTTPSource, RequestInput, RequestOptions, Response} from "@cycle/http";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import sampleCombine from "xstream/extra/sampleCombine";
import {cancelOrders, cancelParentOrder, ifdocoOrder, limitOrder, marketOrder, stopOrder} from "../../../http";
import {State} from "./index";
import {Actions} from "./intent";
import {canClearPosition, isValidLimitOrder, isValidMarketOrder} from "./validation";

export interface OrderRequestBatch {
    requests: RequestInput[];
    _namespace?: string[];
    closePositionSize?: number;
}

interface Submission extends RequestOptions {
    submissionId: symbol;
    closePositionSize?: number;
}

export const closePositionOutcomes = (http: HTTPSource): Stream<{ id: symbol; rejected: boolean }> =>
    http.select("market-order")
        .map((response$) => ({ response$, submission: response$.request as Submission }))
        .filter(({ submission }) => submission.closePositionSize !== undefined && !!submission.submissionId)
        .map(({ response$, submission: { submissionId: id } }) => response$.last()
            .map((response) => ({ id, rejected: isOrderRejection(response) }))
            .replaceError((error) => Stream.of({ id, rejected: isOrderRejection(error?.response) })))
        .compose(flattenConcurrently);

export const submissions = (requests$: Stream<OrderRequestBatch>, http: HTTPSource): Stream<Submission[] | null> => {
    const requested$ = requests$.map(({ requests, _namespace, closePositionSize }) => requests.map((request) => ({
        ...request as RequestOptions,
        _namespace,
        closePositionSize,
        submissionId: Symbol(),
    })));

    const completed$ = http.select()
        .map((response$) => ({ response$, submissionId: (response$.request as Submission).submissionId }))
        .filter(({ submissionId }) => !!submissionId)
        .map(({ response$, submissionId }) =>
            response$.last().mapTo(submissionId).replaceError(() => Stream.of(submissionId)))
        .compose(flattenConcurrently);

    const idle = { batch: null as Submission[] | null, remaining: [] as symbol[] };
    return Stream.merge(completed$, requested$)
        .fold((pending, event) => {
            if (typeof event === "symbol") {
                const remaining = pending.remaining.filter((id) => id !== event);
                return remaining.length ? { ...pending, remaining } : idle;
            }
            return pending.batch ? pending : { batch: event, remaining: event.map(({ submissionId }) => submissionId) };
        }, idle)
        .map(({ batch }) => batch)
        .compose(dropRepeats())
        .remember();
};

export const orderRequests = (actions: Actions, state$: Stream<State>): Stream<OrderRequestBatch> => {
    const withState = (
        click$: Stream<null>,
        toRequest: (state: State) => RequestInput,
        isValid: (state: State) => boolean = () => true,
    ) =>
        click$.compose(sampleCombine(state$))
            .filter(([_, state]) => isValid(state))
            .map(([_, state]) => ({ requests: [toRequest(state)] }));

    return Stream.merge(
        withState(actions.onClickMarketBuyButton$, (state) => marketOrder(state.size, "BUY"), isValidMarketOrder),
        withState(actions.onClickMarketSellButton$, (state) => marketOrder(state.size, "SELL"), isValidMarketOrder),
        withState(actions.onClickLimitBuyButton$, (state) => limitOrder(state.price, state.size, "BUY"), isValidLimitOrder),
        withState(actions.onClickLimitSellButton$, (state) => limitOrder(state.price, state.size, "SELL"), isValidLimitOrder),
        withState(actions.onClickStopBuyButton$, (state) => stopOrder(state.triggerPrice, state.size, "BUY")),
        withState(actions.onClickStopSellButton$, (state) => stopOrder(state.triggerPrice, state.size, "SELL")),
        withState(actions.onClickIFDOCOBuyButton$, ifdocoBuyOrder),
        withState(actions.onClickIFDOCOSellButton$, ifdocoSellOrder),
        actions.onClickClearButton$.compose(sampleCombine(state$))
            .filter(([_, state]) => canClearPosition(state))
            .map(([_, { position }]) => ({
                closePositionSize: position.size,
                requests: [marketOrder(position.size, position.side === "BUY" ? "SELL" : "BUY")],
            })),
        actions.onClickClearOrderButton$.compose(sampleCombine(state$))
            .map(([_, state]) => ({
                requests: [cancelOrders(), ...Object.keys(state.parentStopOrders).map(cancelParentOrder)],
            })),
    );
};

const ifdocoBuyOrder = (state: State): RequestInput =>
    ifdocoOrder(
        state.ifdocoOrder.buyProfitLine(state.currentPrice),
        state.ifdocoOrder.buyLossLine(state.currentPrice),
        state.size,
        "BUY",
    );

const ifdocoSellOrder = (state: State): RequestInput =>
    ifdocoOrder(
        state.ifdocoOrder.sellProfitLine(state.currentPrice),
        state.ifdocoOrder.sellLossLine(state.currentPrice),
        state.size,
        "SELL",
    );

const isOrderRejection = (response?: Response): boolean => {
    const status = response?.status ?? 0;
    const hasDefinitiveStatus = (status >= 200 && status < 300)
        || (status >= 400 && status < 500 && status !== 408);
    if (!response || !hasDefinitiveStatus) return false;
    try {
        const body = JSON.parse(response.text);
        return Number.isFinite(body?.status) && body.status < 0
            && typeof body.error_message === "string" && body.error_message.trim().length > 0;
    } catch {
        return false;
    }
};
