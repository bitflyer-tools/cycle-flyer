import {DOMSource} from "@cycle/dom";
import {Stream} from "xstream";
import {OrderHistory} from "../../../models/orderHistory";
import {Sources} from "../index";
import {createHistoryStream, createParentOrderHistoryStream} from "./history";

export interface Actions {
    onCancelOrders$: Stream<null>;
    onClickClearButton$: Stream<null>;
    onClickClearOrderButton$: Stream<null>;
    onClickIFDOCOBuyButton$: Stream<null>;
    onClickIFDOCOSellButton$: Stream<null>;
    onClickLimitBuyButton$: Stream<null>;
    onClickLimitSellButton$: Stream<null>;
    onClickMarketBuyButton$: Stream<null>;
    onClickMarketSellButton$: Stream<null>;
    onClickSizePresetButton$: Stream<number>;
    onHistoryCreated$: Stream<OrderHistory>;
    onPriceChanged$: Stream<number>;
    onPriceWidthChanged$: Stream<number>;
    onRatioChanged$: Stream<number>;
    onSizeChanged$: Stream<number>;
}

export const intent = (sources: Sources): Actions => {
    const onCancelOrders$ = sources.HTTP.select("cancel-orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .mapTo(null);

    const onHistoryCreated$ = Stream.merge(
        sources.HTTP.select("market-order").map((stream) => createHistoryStream("Market", stream)).flatten(),
        sources.HTTP.select("limit-order").map((stream) => createHistoryStream("Limit", stream)).flatten(),
        sources.HTTP.select("ifdoco-order").map((stream) => createParentOrderHistoryStream(stream)).flatten(),
    );

    return {
        onCancelOrders$,
        onClickClearButton$: clicks(sources.DOM, ".order-buttons", ".clear-button"),
        onClickClearOrderButton$: clicks(sources.DOM, ".order-buttons", ".clear-order-button"),
        onClickIFDOCOBuyButton$: clicks(sources.DOM, ".ranged-ifdoco-order-buttons", ".buy-button"),
        onClickIFDOCOSellButton$: clicks(sources.DOM, ".ranged-ifdoco-order-buttons", ".sell-button"),
        onClickLimitBuyButton$: clicks(sources.DOM, ".limit-order-buttons", ".buy-button"),
        onClickLimitSellButton$: clicks(sources.DOM, ".limit-order-buttons", ".sell-button"),
        onClickMarketBuyButton$: clicks(sources.DOM, ".market-order-buttons", ".buy-button"),
        onClickMarketSellButton$: clicks(sources.DOM, ".market-order-buttons", ".sell-button"),
        onClickSizePresetButton$: sizePresetClicks(sources.DOM),
        onHistoryCreated$,
        onPriceChanged$: numberInputs(sources.DOM, "#price-input"),
        onPriceWidthChanged$: numberInputs(sources.DOM, "#price-width-input"),
        onRatioChanged$: numberInputs(sources.DOM, "#ratio-input"),
        onSizeChanged$: numberInputs(sources.DOM, "#size-input"),
    };
};

const clicks = (dom: DOMSource, container: string, selector: string): Stream<null> =>
    dom.select(container).select(selector)
        .events("click", { preventDefault: true })
        .mapTo(null);

const sizePresetClicks = (dom: DOMSource): Stream<number> =>
    dom.select(".size-presets").select(".size-preset")
        .events("click", { preventDefault: true })
        .map((event: Event) => event.currentTarget as HTMLElement)
        .map((element: HTMLElement) => +(element.dataset.size || 0));

const numberInputs = (dom: DOMSource, selector: string): Stream<number> =>
    dom.select(selector)
        .events("input")
        .map((event: Event) => event.target as HTMLInputElement)
        .map((element: HTMLInputElement) => +element.value);
