import {Stream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {hasApiCredentials} from "../../../credentials";
import sampleCombine from "xstream/extra/sampleCombine";
import {TwapSliceRequest} from "../../../http";
import {canStart, isValidTwapInterval} from "../../../models/twapOrder";
import {loadNumber, loadStoredValue} from "../../../storage";
import {Sources} from "../index";
import {State} from "./index";
import {clicks, numberInputs} from "./events";
import {createChildOrderOutcome, OrderOutcome} from "./history";

export interface TwapSchedule {
    id: symbol;
    side: "BUY" | "SELL";
}

export interface TwapSliceOutcome extends OrderOutcome {
    scheduleId: symbol;
}

export interface TwapActions {
    onClickTwapCancelButton$: Stream<null>;
    onTwapIntervalChanged$: Stream<number>;
    onTwapIntervalLoaded$: Stream<number>;
    onTwapSliceOutcome$: Stream<TwapSliceOutcome>;
    onTwapSlicesChanged$: Stream<number>;
    onTwapSlicesLoaded$: Stream<number>;
    onTwapStarted$: Stream<TwapSchedule>;
}

export const twapStorageKeys = {
    interval: "twap-interval",
    slices: "twap-slices",
};

export const twapIntent = (sources: Sources, state$: Stream<State>): TwapActions => ({
    onClickTwapCancelButton$: clicks(sources.DOM, ".twap-order-buttons", ".cancel-button"),
    onTwapIntervalChanged$: numberInputs(sources.DOM, "#twap-interval-input"),
    onTwapIntervalLoaded$: loadStoredValue(sources.storage, twapStorageKeys.interval)
        .take(1)
        .map((value) => +value)
        .map((interval) => isValidTwapInterval(interval) ? interval : 0),
    onTwapSliceOutcome$: sources.HTTP.select("twap-order")
        .map((response$) => {
            const {scheduleId} = response$.request as TwapSliceRequest;
            return createChildOrderOutcome("TWAP", response$).map((outcome) => ({ ...outcome, scheduleId }));
        })
        .compose(flattenConcurrently),
    onTwapSlicesChanged$: numberInputs(sources.DOM, "#twap-slices-input"),
    onTwapSlicesLoaded$: loadNumber(sources.storage, twapStorageKeys.slices),
    onTwapStarted$: Stream.merge(
        clicks(sources.DOM, ".twap-order-buttons", ".buy-button").mapTo("BUY" as const),
        clicks(sources.DOM, ".twap-order-buttons", ".sell-button").mapTo("SELL" as const),
    ).compose(sampleCombine(state$))
        .filter(([_, state]) => hasApiCredentials() && canStart(state.twap, state.size))
        .map(([side]) => ({ id: Symbol(), side })),
});
