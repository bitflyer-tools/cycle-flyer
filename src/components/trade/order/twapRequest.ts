import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {credentialsChanging$} from "../../../credentials";
import {TwapSliceRequest, twapSliceOrder} from "../../../http";
import {sliceSize} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions} from "./twapIntent";

export const twapSigningFailed$ = Stream.create<void>();

let activeRun: symbol | null = null;

export const twapRequest = (actions: TwapActions, state$: Stream<State>): Stream<RequestInput> => {
    const start$ = Stream.merge(
        actions.onClickTwapBuyButton$.mapTo("BUY"),
        actions.onClickTwapSellButton$.mapTo("SELL"),
    ).compose(sampleCombine(state$));
    const stop$ = Stream.merge(actions.onClickTwapCancelButton$, credentialsChanging$, twapSigningFailed$);

    return Stream.merge(start$, stop$.mapTo(null))
        .map((start) => {
            if (!start) {
                activeRun = null;
                return Stream.never<RequestInput>();
            }

            const id = Symbol();
            activeRun = id;
            const [side, state] = start;
            return slices(state, side, () => activeRun === id);
        })
        .flatten();
};

const slices = (state: State, side: string, isTwapActive: () => boolean): Stream<RequestInput> =>
    Stream.periodic(state.twap.interval * 1000)
        .startWith(-1)
        .take(state.twap.slices)
        .map<RequestInput>(() => ({
            ...twapSliceOrder(sliceSize(state.size, state.twap.slices), side),
            isTwapActive,
            onSigningFailure: () => {
                if (isTwapActive()) { twapSigningFailed$.shamefullySendNext(undefined); }
            },
        } satisfies TwapSliceRequest));
