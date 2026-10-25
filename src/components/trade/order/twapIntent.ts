import {Stream} from "xstream";
import {OrderHistory} from "../../../models/orderHistory";
import {loadNumber} from "../../../storage";
import {Sources} from "../index";
import {clicks, numberInputs} from "./events";
import {createHistoryStream} from "./history";

export interface TwapActions {
    onClickTwapBuyButton$: Stream<null>;
    onClickTwapCancelButton$: Stream<null>;
    onClickTwapSellButton$: Stream<null>;
    onTwapIntervalChanged$: Stream<number>;
    onTwapIntervalLoaded$: Stream<number>;
    onTwapSliceCreated$: Stream<OrderHistory>;
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
    onTwapIntervalLoaded$: loadNumber(sources.storage, twapStorageKeys.interval),
    onTwapSliceCreated$: sources.HTTP.select("twap-order")
        .map((stream) => createHistoryStream("TWAP", stream))
        .flatten(),
    onTwapSlicesChanged$: numberInputs(sources.DOM, "#twap-slices-input"),
    onTwapSlicesLoaded$: loadNumber(sources.storage, twapStorageKeys.slices),
});
