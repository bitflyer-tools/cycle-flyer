import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {Actions} from "./intent";
import {
    cancelOrders, getBoard, getCollateral, getOrders, getPositions, getState, limitOrder,
    marketOrder
} from '../../http';
import {State} from "./model";

export const request = (actions: Actions, state$: Stream<State>): Stream<RequestInput> => {
    const orders = Stream.periodic(3000).mapTo(getOrders()).startWith(getOrders());
    const positions = Stream.periodic(3000).mapTo(getPositions()).startWith(getPositions());

    const marketBuy = actions.onClickMarketBuyButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "BUY"));

    const marketSell = actions.onClickMarketSellButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "SELL"));

    const limitBuy = actions.onClickLimitBuyButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => limitOrder(state.price, state.size, "BUY"));

    const limitSell = actions.onClickLimitSellButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => limitOrder(state.price, state.size, "SELL"));

    const clear = actions.onClickClearButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.position.size, state.position.side === "BUY" ? "SELL" : "BUY"));

    const clearOrders = actions.onClickClearOrderButton$
        .map(_ => cancelOrders());

    return Stream.merge(
        orders,
        positions,
        marketBuy,
        marketSell,
        limitBuy,
        limitSell,
        clear,
        clearOrders
    );
};
