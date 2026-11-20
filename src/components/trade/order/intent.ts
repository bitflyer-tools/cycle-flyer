import {Stream} from "xstream";
import {loadNumber} from "../../../storage";
import {Sources} from "../index";
import {State} from "./index";
import {clicks, numberInputs, sizePresetClicks} from "./events";
import {OrderOutcome, orderOutcomes} from "./history";
import {TwapActions, twapIntent} from "./twapIntent";

export interface Actions extends TwapActions {
    onClickClearButton$: Stream<null>;
    onClickClearOrderButton$: Stream<null>;
    onClickIFDOCOBuyButton$: Stream<null>;
    onClickIFDOCOSellButton$: Stream<null>;
    onClickLimitBuyButton$: Stream<null>;
    onClickLimitSellButton$: Stream<null>;
    onClickMarketBuyButton$: Stream<null>;
    onClickMarketSellButton$: Stream<null>;
    onClickSizePresetButton$: Stream<number>;
    onClickStopBuyButton$: Stream<null>;
    onClickStopSellButton$: Stream<null>;
    onOrderOutcome$: Stream<OrderOutcome>;
    onPriceChanged$: Stream<number>;
    onPriceWidthChanged$: Stream<number>;
    onPriceWidthLoaded$: Stream<number>;
    onRatioChanged$: Stream<number>;
    onRatioLoaded$: Stream<number>;
    onSizeChanged$: Stream<number>;
    onSizeLoaded$: Stream<number>;
    onTriggerPriceChanged$: Stream<number>;
}

export const storageKeys = {
    priceWidth: "ifdoco-price-width",
    ratio: "ifdoco-ratio",
    size: "order-size",
};

export const intent = (sources: Sources, state$: Stream<State>): Actions => {
    return {
        ...twapIntent(sources, state$),
        onClickClearButton$: clicks(sources.DOM, ".order-buttons", ".clear-button"),
        onClickClearOrderButton$: clicks(sources.DOM, ".order-buttons", ".clear-order-button"),
        onClickIFDOCOBuyButton$: clicks(sources.DOM, ".ranged-ifdoco-order-buttons", ".buy-button"),
        onClickIFDOCOSellButton$: clicks(sources.DOM, ".ranged-ifdoco-order-buttons", ".sell-button"),
        onClickLimitBuyButton$: clicks(sources.DOM, ".limit-order-buttons", ".buy-button"),
        onClickLimitSellButton$: clicks(sources.DOM, ".limit-order-buttons", ".sell-button"),
        onClickMarketBuyButton$: clicks(sources.DOM, ".market-order-buttons", ".buy-button"),
        onClickMarketSellButton$: clicks(sources.DOM, ".market-order-buttons", ".sell-button"),
        onClickSizePresetButton$: sizePresetClicks(sources.DOM),
        onClickStopBuyButton$: clicks(sources.DOM, ".stop-order-buttons", ".buy-button"),
        onClickStopSellButton$: clicks(sources.DOM, ".stop-order-buttons", ".sell-button"),
        onOrderOutcome$: orderOutcomes(sources.HTTP),
        onPriceChanged$: numberInputs(sources.DOM, "#price-input"),
        onPriceWidthChanged$: numberInputs(sources.DOM, "#price-width-input"),
        onPriceWidthLoaded$: loadNumber(sources.storage, storageKeys.priceWidth, () => true),
        onRatioChanged$: numberInputs(sources.DOM, "#ratio-input"),
        onRatioLoaded$: loadNumber(sources.storage, storageKeys.ratio),
        onSizeChanged$: numberInputs(sources.DOM, "#size-input"),
        onSizeLoaded$: loadNumber(sources.storage, storageKeys.size),
        onTriggerPriceChanged$: numberInputs(sources.DOM, "#trigger-price-input"),
    };
};
