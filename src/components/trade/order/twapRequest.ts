import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {credentialsChanging$} from "../../../credentials";
import {TwapSliceRequest, twapSliceOrder} from "../../../http";
import {sliceSize} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions, TwapSchedule} from "./twapIntent";

export const twapSigningFailed$ = Stream.create<void>();

let activeRun: symbol | null = null;

export const stopTwap = (): void => { activeRun = null; };

export const twapRequest = (actions: TwapActions, state$: Stream<State>): Stream<RequestInput> => {
    const start$ = actions.onTwapStarted$.compose(sampleCombine(state$));
    const stop$ = Stream.merge(actions.onClickTwapCancelButton$, credentialsChanging$, twapSigningFailed$);

    return Stream.merge(start$, stop$.mapTo(null))
        .map((start) => {
            if (!start) {
                stopTwap();
                return Stream.never<RequestInput>();
            }

            const [schedule, state] = start;
            activeRun = schedule.id;
            return slices(state, schedule, () => activeRun === schedule.id);
        })
        .flatten();
};

const slices = (state: State, schedule: TwapSchedule, isTwapActive: () => boolean): Stream<RequestInput> =>
    Stream.periodic(state.twap.interval * 1000)
        .startWith(-1)
        .take(state.twap.slices)
        .map<RequestInput>(() => ({
            ...twapSliceOrder(sliceSize(state.size, state.twap.slices), schedule.side, schedule.id),
            isTwapActive,
            onSigningFailure: () => {
                if (isTwapActive()) { twapSigningFailed$.shamefullySendNext(undefined); }
            },
        } satisfies TwapSliceRequest));
