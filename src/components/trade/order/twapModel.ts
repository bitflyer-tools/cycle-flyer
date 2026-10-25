import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {TwapOrder} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions} from "./twapIntent";

export const twapModel = (actions: TwapActions): Stream<Reducer<State>> => {
    const intervalReducer$ = Stream.merge(actions.onTwapIntervalChanged$, actions.onTwapIntervalLoaded$)
        .map((interval) => updateTwap((twap) => ({ ...twap, interval })));

    const slicesReducer$ = Stream.merge(actions.onTwapSlicesChanged$, actions.onTwapSlicesLoaded$)
        .map((slices) => updateTwap((twap) => ({ ...twap, slices })));

    const startReducer$ = Stream.merge(actions.onClickTwapBuyButton$, actions.onClickTwapSellButton$)
        .map((_) => updateTwap((twap) => ({ ...twap, remaining: twap.slices })));

    const sliceReducer$ = actions.onTwapSliceCreated$
        .map((_) => updateTwap((twap) => ({ ...twap, remaining: Math.max(twap.remaining - 1, 0) })));

    const cancelReducer$ = actions.onClickTwapCancelButton$
        .map((_) => updateTwap((twap) => ({ ...twap, remaining: 0 })));

    return Stream.merge(intervalReducer$, slicesReducer$, startReducer$, sliceReducer$, cancelReducer$);
};

const updateTwap = (update: (twap: TwapOrder) => TwapOrder): Reducer<State> =>
    ((state: State) => ({ ...state, twap: update(state.twap) })) as Reducer<State>;
