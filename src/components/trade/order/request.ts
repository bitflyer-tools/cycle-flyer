import {HTTPSource, RequestInput, RequestOptions} from "@cycle/http";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import sampleCombine from "xstream/extra/sampleCombine";
import {cancelOrders, cancelParentOrder, ifdocoOrder, limitOrder, marketOrder, stopOrder} from "../../../http";
import {State} from "./index";
import {Actions} from "./intent";

export interface OrderRequestBatch {
    requests: RequestInput[];
    _namespace?: string[];
}

interface Submission extends RequestOptions {
    submissionId: symbol;
}

export const submissions = (requests$: Stream<OrderRequestBatch>, http: HTTPSource): Stream<Submission[] | null> => {
    const requested$ = requests$.map(({ requests, _namespace }) => requests.map((request) => ({
        ...request as RequestOptions,
        _namespace,
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
    const clickedState = (click$: Stream<null>) =>
        click$.compose(sampleCombine(state$)).map(([_, state]) => state);
    const toBatch = (request: RequestInput): OrderRequestBatch => ({ requests: [request] });
    const withState = (click$: Stream<null>, toRequest: (state: State) => RequestInput) =>
        clickedState(click$).map((state) => toBatch(toRequest(state)));
    const withIFDOCOState = (click$: Stream<null>, toRequest: (state: State) => RequestInput) =>
        clickedState(click$)
            .filter((state) => state.ifdocoOrder.hasValidWidth())
            .map((state) => toBatch(toRequest(state)));

    return Stream.merge(
        withState(actions.onClickMarketBuyButton$, (state) => marketOrder(state.size, "BUY")),
        withState(actions.onClickMarketSellButton$, (state) => marketOrder(state.size, "SELL")),
        withState(actions.onClickLimitBuyButton$, (state) => limitOrder(state.price, state.size, "BUY")),
        withState(actions.onClickLimitSellButton$, (state) => limitOrder(state.price, state.size, "SELL")),
        withState(actions.onClickStopBuyButton$, (state) => stopOrder(state.triggerPrice, state.size, "BUY")),
        withState(actions.onClickStopSellButton$, (state) => stopOrder(state.triggerPrice, state.size, "SELL")),
        withIFDOCOState(actions.onClickIFDOCOBuyButton$, ifdocoBuyOrder),
        withIFDOCOState(actions.onClickIFDOCOSellButton$, ifdocoSellOrder),
        withState(actions.onClickClearButton$, clearPositionOrder),
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

const clearPositionOrder = (state: State): RequestInput =>
    marketOrder(state.position.size, state.position.side === "BUY" ? "SELL" : "BUY");
