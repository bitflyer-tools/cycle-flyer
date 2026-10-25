import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {cancelOrders, ifdocoOrder, limitOrder, marketOrder} from "../../../http";
import {State} from "./index";
import {Actions} from "./intent";

export const request = (actions: Actions, state$: Stream<State>): Stream<string | RequestInput | null> => {
    const withState = (click$: Stream<null>, toRequest: (state: State) => RequestInput) =>
        click$.compose(sampleCombine(state$)).map(([_, state]) => toRequest(state));

    return Stream.merge(
        withState(actions.onClickMarketBuyButton$, (state) => marketOrder(state.size, "BUY")),
        withState(actions.onClickMarketSellButton$, (state) => marketOrder(state.size, "SELL")),
        withState(actions.onClickLimitBuyButton$, (state) => limitOrder(state.price, state.size, "BUY")),
        withState(actions.onClickLimitSellButton$, (state) => limitOrder(state.price, state.size, "SELL")),
        withState(actions.onClickIFDOCOBuyButton$, ifdocoBuyOrder),
        withState(actions.onClickIFDOCOSellButton$, ifdocoSellOrder),
        withState(actions.onClickClearButton$, clearPositionOrder),
        actions.onClickClearOrderButton$.map((_) => cancelOrders()),
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
