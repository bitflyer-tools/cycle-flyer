import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {apiCredentials} from "../../../credentials";
import {twapSliceOrder} from "../../../http";
import {sliceSize} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions, TwapSchedule} from "./twapIntent";

export const twapRequest = (actions: TwapActions, state$: Stream<State>): Stream<RequestInput> =>
    actions.onTwapStarted$
        .compose(sampleCombine(state$))
        .map(([schedule, state]) => slices(state, schedule).endWhen(actions.onClickTwapCancelButton$))
        .flatten();

const slices = (state: State, schedule: TwapSchedule): Stream<RequestInput> => {
    const { version } = apiCredentials();
    return Stream.periodic(state.twap.interval * 1000)
        .startWith(-1)
        .take(state.twap.slices)
        .filter(() => version === apiCredentials().version)
        .map<RequestInput>((_) => twapSliceOrder(sliceSize(state.size, state.twap.slices), schedule.side, schedule.id));
};
