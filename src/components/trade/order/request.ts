import {HTTPSource, RequestInput, RequestOptions} from "@cycle/http";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import sampleCombine from "xstream/extra/sampleCombine";
import {currentCredentialVersion} from "../../../credentials";
import {AccountRequest, unsignedRequests$} from "../../../drivers/httpDriver";
import {cancelOrders, cancelParentOrder, ifdocoOrder, limitOrder, marketOrder, stopOrder} from "../../../http";
import {State} from "./index";
import {Actions} from "./intent";
import {isValidIFDOCOOrder, isValidLimitOrder, isValidMarketOrder} from "./validation";

export interface OrderRequestBatch {
    requests: RequestInput[];
    _namespace?: string[];
}

interface Submission extends RequestOptions {
    submissionId: symbol;
}

export const unsignedSubmissions$ = unsignedRequests$
    .map((request) => request as Submission)
    .filter(({ submissionId }) => !!submissionId);

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

    const unsigned$ = unsignedSubmissions$.map(({ submissionId }) => submissionId);

    const idle = { batch: null as Submission[] | null, remaining: [] as symbol[] };
    return Stream.merge(completed$, unsigned$, requested$)
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

export const canClearPosition = (state: State): boolean =>
    !state.isOrdering && state.position.size !== 0 && state.positionCredentialVersion !== undefined
    && state.positionCredentialVersion === currentCredentialVersion();

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
        withState(actions.onClickIFDOCOBuyButton$, ifdocoBuyOrder, isValidIFDOCOOrder),
        withState(actions.onClickIFDOCOSellButton$, ifdocoSellOrder, isValidIFDOCOOrder),
        actions.onClickClearButton$.compose(sampleCombine(state$))
            .filter(([_, state]) => canClearPosition(state))
            .map(([_, state]) => ({ requests: [clearPositionOrder(state)] })),
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

const clearPositionOrder = (state: State): AccountRequest => ({
    ...marketOrder(state.position.size, state.position.side === "BUY" ? "SELL" : "BUY") as RequestOptions,
    credentialVersion: state.positionCredentialVersion,
});
