import {HTTPSource, RequestInput, RequestOptions} from "@cycle/http";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import sampleCombine from "xstream/extra/sampleCombine";
import {unsignedRequests$} from "../../../drivers/httpDriver";
import {cancelOrders, ifdocoOrder, limitOrder, marketOrder, stopOrder} from "../../../http";
import {State} from "./index";
import {Actions} from "./intent";

interface Submission extends RequestOptions {
    submissionId: symbol;
}

export const submissions = (requests$: Stream<RequestInput>, http: HTTPSource): Stream<Submission | null> => {
    const requested$ = requests$
        .map((request) => ({ ...request as RequestOptions, submissionId: Symbol() }));

    const completed$ = http.select()
        .map((response$) => ({ response$, submissionId: (response$.request as Submission).submissionId }))
        .filter(({ submissionId }) => !!submissionId)
        .map(({ response$, submissionId }) =>
            response$.last().mapTo(submissionId).replaceError(() => Stream.of(submissionId)))
        .compose(flattenConcurrently);

    const unsigned$ = unsignedRequests$
        .map((request) => (request as Submission).submissionId)
        .filter((id) => !!id);

    return Stream.merge(completed$, unsigned$, requested$)
        .fold<Submission | null>((pending, event) => {
            if (typeof event === "symbol") {
                return pending?.submissionId === event ? null : pending;
            }
            return pending || event;
        }, null)
        .compose(dropRepeats())
        .remember();
};

export const orderRequests = (actions: Actions, state$: Stream<State>): Stream<RequestInput> => {
    const withState = (click$: Stream<null>, toRequest: (state: State) => RequestInput) =>
        click$.compose(sampleCombine(state$)).map(([_, state]) => toRequest(state));

    return Stream.merge(
        withState(actions.onClickMarketBuyButton$, (state) => marketOrder(state.size, "BUY")),
        withState(actions.onClickMarketSellButton$, (state) => marketOrder(state.size, "SELL")),
        withState(actions.onClickLimitBuyButton$, (state) => limitOrder(state.price, state.size, "BUY")),
        withState(actions.onClickLimitSellButton$, (state) => limitOrder(state.price, state.size, "SELL")),
        withState(actions.onClickStopBuyButton$, (state) => stopOrder(state.triggerPrice, state.size, "BUY")),
        withState(actions.onClickStopSellButton$, (state) => stopOrder(state.triggerPrice, state.size, "SELL")),
        withState(actions.onClickIFDOCOBuyButton$, ifdocoBuyOrder),
        withState(actions.onClickIFDOCOSellButton$, ifdocoSellOrder),
        withState(actions.onClickClearButton$, clearPositionOrder),
        actions.onClickClearOrderButton$.map(() => cancelOrders()),
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
