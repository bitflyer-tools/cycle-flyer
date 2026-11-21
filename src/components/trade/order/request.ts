import {HTTPSource, RequestInput, RequestOptions, Response} from "@cycle/http";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import sampleCombine from "xstream/extra/sampleCombine";
import {credentialsChanging$, currentCredentialVersion} from "../../../credentials";
import {AccountRequest, unsignedRequests$} from "../../../drivers/httpDriver";
import {cancelOrders, cancelParentOrder, ifdocoOrder, limitOrder, marketOrder, stopOrder} from "../../../http";
import {State} from "./index";
import {Actions} from "./intent";
import {canClearPosition, isValidIFDOCOOrder, isValidLimitOrder, isValidMarketOrder, isValidStopOrder} from "./validation";

export interface OrderRequestBatch {
    requests: RequestInput[];
    _namespace?: string[];
    closePositionSize?: number;
}

interface Submission extends AccountRequest {
    submissionId: symbol;
    closePositionSize?: number;
}

export const unsignedSubmissions$ = unsignedRequests$
    .map((request) => request as Submission)
    .filter(({ submissionId, credentialVersion }) => !!submissionId
        && (credentialVersion === undefined || credentialVersion === currentCredentialVersion()));

export const closePositionOutcomes = (http: HTTPSource): Stream<{ id: symbol; rejected: boolean }> =>
    Stream.merge(
        http.select("market-order")
            .map((response$) => ({ response$, submission: response$.request as Submission }))
            .filter(({ submission }) => submission.closePositionSize !== undefined && !!submission.submissionId)
            .map(({ response$, submission: { submissionId: id } }) => response$.last()
                .map((response) => ({ id, rejected: isOrderRejection(response) }))
                .replaceError((error) => Stream.of({ id, rejected: isOrderRejection(error?.response) })))
            .compose(flattenConcurrently),
        unsignedSubmissions$.filter(({ closePositionSize }) => closePositionSize !== undefined)
            .map(({ submissionId: id }) => ({ id, rejected: true })),
    );

export const submissions = (requests$: Stream<OrderRequestBatch>, http: HTTPSource): Stream<Submission[] | null> => {
    const requested$ = requests$.map(({ requests, _namespace, closePositionSize }) => requests.map((request) => ({
        credentialVersion: currentCredentialVersion() ?? undefined,
        ...request as AccountRequest,
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

    const unsigned$ = unsignedSubmissions$.map(({ submissionId }) => submissionId);

    const idle = { batch: null as Submission[] | null, remaining: [] as symbol[] };
    return Stream.merge(completed$, unsigned$, requested$, credentialsChanging$.mapTo(null))
        .fold((pending, event) => {
            if (event === null) { return idle; }
            if (typeof event === "symbol") {
                if (!pending.remaining.includes(event)) { return pending; }
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
        withState(actions.onClickStopBuyButton$, (state) => stopOrder(state.triggerPrice, state.size, "BUY"),
            (state) => isValidStopOrder(state, "BUY")),
        withState(actions.onClickStopSellButton$, (state) => stopOrder(state.triggerPrice, state.size, "SELL"),
            (state) => isValidStopOrder(state, "SELL")),
        withState(actions.onClickIFDOCOBuyButton$, ifdocoBuyOrder, isValidIFDOCOOrder),
        withState(actions.onClickIFDOCOSellButton$, ifdocoSellOrder, isValidIFDOCOOrder),
        actions.onClickClearButton$.compose(sampleCombine(state$))
            .filter(([_, state]) => canClearPosition(state))
            .map(([_, state]) => ({
                closePositionSize: state.position.size,
                requests: [clearPositionOrder(state)],
            })),
        actions.onClickClearOrderButton$.compose(sampleCombine(state$))
            .filter(([_, state]) => currentCredentialVersion() !== null
                && state.orders.length + Object.keys(state.parentStopOrders).length > 0)
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
