import {div, VNode} from "@cycle/dom";
import {MarketFills} from "../../../models/marketFill";

type MarketFill = MarketFills["buy"];

export const marketFillPreview = (fills: MarketFills): VNode =>
    div(".market-fill-preview", [
        div("Live average fill estimates (before fees)"),
        div("Price difference vs. best quote"),
        div(".market-fill-sides", [
            div([div("Sell"), div(describeFill(fills.sell))]),
            div([div("Buy"), div(describeFill(fills.buy))]),
        ]),
    ]);

export const sameMarketFills = (previous: MarketFills | undefined, next: MarketFills | undefined): boolean =>
    sameFill(previous?.buy, next?.buy) && sameFill(previous?.sell, next?.sell);

const sameFill = (previous: MarketFill | undefined, next: MarketFill | undefined): boolean =>
    previous?.status === next?.status && (previous?.status !== "estimated" ||
        (next?.status === "estimated" && previous.averagePrice === next.averagePrice &&
            previous.priceDifferencePercent === next.priceDifferencePercent));

const describeFill = (fill: MarketFill): string => {
    if (fill.status === "unavailable") { return "Order book unavailable"; }
    if (fill.status === "insufficient") { return "Insufficient depth"; }
    const price = fill.averagePrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const difference = fill.priceDifferencePercent;
    const sign = difference > 0 ? "+" : "";
    return `${price} JPY (${sign}${difference.toFixed(4)}%)`;
};
