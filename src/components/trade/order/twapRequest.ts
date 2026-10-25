import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {twapSliceOrder} from "../../../http";
import {sliceSize} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions} from "./twapIntent";

export const twapRequest = (actions: TwapActions, state$: Stream<State>): Stream<RequestInput> =>
    Stream.merge(
        actions.onClickTwapBuyButton$.compose(sampleCombine(state$)).map(([_, state]) => slices(state, "BUY")),
        actions.onClickTwapSellButton$.compose(sampleCombine(state$)).map(([_, state]) => slices(state, "SELL")),
    )
        .map((slice$) => slice$.endWhen(actions.onClickTwapCancelButton$))
        .flatten();

const slices = (state: State, side: string): Stream<RequestInput> =>
    Stream.periodic(state.twap.interval * 1000)
        .startWith(-1)
        .take(state.twap.slices)
        .map((_) => twapSliceOrder(sliceSize(state.size, state.twap.slices), side));
