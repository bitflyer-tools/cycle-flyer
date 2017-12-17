import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {Actions} from "./intent";
import {cancelOrders, getCollateral, getPositions, getState, marketOrder} from '../../http';
import {State} from "./model";

export const request = (actions: Actions, state$: Stream<State>): Stream<RequestInput> => {
    const collateral = Stream.periodic(10000).mapTo(getCollateral()).startWith(getCollateral());
    const positions = Stream.periodic(3000).mapTo(getPositions()).startWith(getPositions());
    const state = Stream.periodic(3000).mapTo(getState()).startWith(getState());

    const buy = actions.onClickBuyButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "BUY"));

    const sell = actions.onClickSellButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "SELL"));

    const clear = actions.onClickClearButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.position.size, state.position.side === "BUY" ? "SELL" : "BUY"));

    const clearOrders = actions.onClickClearOrderButton$
        .map(_ => cancelOrders());

    return Stream.merge(collateral, positions, buy, sell, clear, clearOrders, state);
};
