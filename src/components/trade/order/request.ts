import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {cancelOrders, ifdocoOrder, limitOrder, marketOrder, stopOrder} from "../../../http";
import {State} from "./index";
import {Actions} from "./intent";
import {twapRequest} from "./twapRequest";
import {isValidLimitOrder, isValidMarketOrder} from "./validation";

export const request = (actions: Actions, state$: Stream<State>): Stream<string | RequestInput | null> => {
    const withState = (
        click$: Stream<null>,
        toRequest: (state: State) => RequestInput,
        isValid: (state: State) => boolean = () => true,
    ) =>
        click$.compose(sampleCombine(state$))
            .filter(([_, state]) => isValid(state))
            .map(([_, state]) => toRequest(state));

    return Stream.merge(
        withState(actions.onClickMarketBuyButton$, (state) => marketOrder(state.size, "BUY"), isValidMarketOrder),
        withState(actions.onClickMarketSellButton$, (state) => marketOrder(state.size, "SELL"), isValidMarketOrder),
        withState(actions.onClickLimitBuyButton$, (state) => limitOrder(state.price, state.size, "BUY"), isValidLimitOrder),
        withState(actions.onClickLimitSellButton$, (state) => limitOrder(state.price, state.size, "SELL"), isValidLimitOrder),
        withState(actions.onClickStopBuyButton$, (state) => stopOrder(state.triggerPrice, state.size, "BUY")),
        withState(actions.onClickStopSellButton$, (state) => stopOrder(state.triggerPrice, state.size, "SELL")),
        withState(actions.onClickIFDOCOBuyButton$, ifdocoBuyOrder),
        withState(actions.onClickIFDOCOSellButton$, ifdocoSellOrder),
        withState(actions.onClickClearButton$, clearPositionOrder),
        actions.onClickClearOrderButton$.map((_) => cancelOrders()),
        twapRequest(actions, state$),
    ) as Stream<string | RequestInput | null>;
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
