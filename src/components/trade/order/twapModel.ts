import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {TwapOrder} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions} from "./twapIntent";
import {TwapLifecycle} from "./twapRequest";

export const twapModel = (actions: TwapActions, lifecycle$: Stream<TwapLifecycle>): Stream<Reducer<State>> => {
    const intervalReducer$ = Stream.merge(actions.onTwapIntervalChanged$, actions.onTwapIntervalLoaded$)
        .map((interval) => updateTwap((twap) => ({ ...twap, interval })));

    const slicesReducer$ = Stream.merge(actions.onTwapSlicesChanged$, actions.onTwapSlicesLoaded$)
        .map((slices) => updateTwap((twap) => ({ ...twap, slices })));

    const lifecycleReducer$ = lifecycle$.map((event) => updateTwap((twap) => {
        if (event.type === "started") {
            const {id, totalSlices} = event;
            return { ...twap, error: undefined, remaining: totalSlices, totalSlices, scheduleId: id };
        }
        if (twap.scheduleId !== event.id || !twap.remaining) { return twap; }
        return { ...twap, remaining: 0, scheduleId: undefined, error: event.error ?? twap.error };
    }));

    const sliceReducer$ = actions.onTwapSliceOutcome$
        .map<Reducer<State>>(({scheduleId}) => (state) =>
            state && state.twap.scheduleId === scheduleId
                ? { ...state, twap: { ...state.twap, remaining: Math.max(state.twap.remaining - 1, 0) } }
                : state);

    return Stream.merge(intervalReducer$, slicesReducer$, lifecycleReducer$, sliceReducer$);
};

const updateTwap = (update: (twap: TwapOrder) => TwapOrder): Reducer<State> =>
    ((state: State) => ({ ...state, twap: update(state.twap) })) as Reducer<State>;
