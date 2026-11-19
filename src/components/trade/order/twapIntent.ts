import {Stream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {isValidTwapInterval} from "../../../models/twapOrder";
import {loadNumber, loadStoredValue} from "../../../storage";
import {Sources} from "../index";
import {clicks, numberInputs} from "./events";
import {createChildOrderOutcome, OrderOutcome} from "./history";

export interface TwapActions {
    onClickTwapBuyButton$: Stream<null>;
    onClickTwapCancelButton$: Stream<null>;
    onClickTwapSellButton$: Stream<null>;
    onTwapIntervalChanged$: Stream<number>;
    onTwapIntervalLoaded$: Stream<number>;
    onTwapSliceOutcome$: Stream<OrderOutcome>;
    onTwapSlicesChanged$: Stream<number>;
    onTwapSlicesLoaded$: Stream<number>;
}

export const twapStorageKeys = {
    interval: "twap-interval",
    slices: "twap-slices",
};

export const twapIntent = (sources: Sources): TwapActions => ({
    onClickTwapBuyButton$: clicks(sources.DOM, ".twap-order-buttons", ".buy-button"),
    onClickTwapCancelButton$: clicks(sources.DOM, ".twap-order-buttons", ".cancel-button"),
    onClickTwapSellButton$: clicks(sources.DOM, ".twap-order-buttons", ".sell-button"),
    onTwapIntervalChanged$: numberInputs(sources.DOM, "#twap-interval-input"),
    onTwapIntervalLoaded$: loadStoredValue(sources.storage, twapStorageKeys.interval)
        .take(1)
        .map((value) => +value)
        .map((interval) => isValidTwapInterval(interval) ? interval : 0),
    onTwapSliceOutcome$: sources.HTTP.select("twap-order")
        .map((stream) => createChildOrderOutcome("TWAP", stream))
        .compose(flattenConcurrently),
    onTwapSlicesChanged$: numberInputs(sources.DOM, "#twap-slices-input"),
    onTwapSlicesLoaded$: loadNumber(sources.storage, twapStorageKeys.slices),
});
