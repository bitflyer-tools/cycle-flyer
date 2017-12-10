import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {Actions} from "./intent";
import {getCollateral, getPositions, marketOrder} from '../../http';
import {State} from "./model";

export const request = (actions: Actions, state$: Stream<State>): Stream<RequestInput> => {
    const collateral = Stream.periodic(10000).mapTo(getCollateral());
    const positions = Stream.periodic(3000).mapTo(getPositions());

    const buy = actions.onClickBuyButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "BUY"));

    const sell = actions.onClickSellButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "SELL"));

    return Stream.merge(collateral, positions, buy, sell);
};
