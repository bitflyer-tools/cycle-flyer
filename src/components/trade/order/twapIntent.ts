import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {TwapSliceRequest} from "../../../http";
import {OrderHistory} from "../../../models/orderHistory";
import {loadNumber} from "../../../storage";
import {Sources} from "../index";
import {clicks, numberInputs} from "./events";
import {createHistoryStream} from "./history";

export interface TwapSchedule {
    id: symbol;
    side: "BUY" | "SELL";
}

export interface TwapSliceResult {
    history: OrderHistory;
    scheduleId: symbol;
}

export interface TwapActions {
    onClickTwapCancelButton$: Stream<null>;
    onTwapIntervalChanged$: Stream<number>;
    onTwapIntervalLoaded$: Stream<number>;
    onTwapSliceCreated$: Stream<TwapSliceResult>;
    onTwapSlicesChanged$: Stream<number>;
    onTwapSlicesLoaded$: Stream<number>;
    onTwapStarted$: Stream<TwapSchedule>;
}

export const twapStorageKeys = {
    interval: "twap-interval",
    slices: "twap-slices",
};

export const twapIntent = (sources: Sources): TwapActions => ({
    onClickTwapCancelButton$: clicks(sources.DOM, ".twap-order-buttons", ".cancel-button"),
    onTwapIntervalChanged$: numberInputs(sources.DOM, "#twap-interval-input"),
    onTwapIntervalLoaded$: loadNumber(sources.storage, twapStorageKeys.interval),
    onTwapSliceCreated$: sources.HTTP.select("twap-order")
        .map((response$) => {
            const {scheduleId} = response$.request as TwapSliceRequest;
            return createHistoryStream("TWAP", response$).take(1).map((history) => ({ history, scheduleId }));
        })
        .compose(flattenConcurrently),
    onTwapSlicesChanged$: numberInputs(sources.DOM, "#twap-slices-input"),
    onTwapSlicesLoaded$: loadNumber(sources.storage, twapStorageKeys.slices),
    onTwapStarted$: Stream.merge(
        clicks(sources.DOM, ".twap-order-buttons", ".buy-button").mapTo("BUY" as const),
        clicks(sources.DOM, ".twap-order-buttons", ".sell-button").mapTo("SELL" as const),
    ).map((side) => ({ id: Symbol(), side })),
});
