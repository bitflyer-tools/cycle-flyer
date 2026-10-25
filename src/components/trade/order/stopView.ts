import {button, div, h4, VNode} from "@cycle/dom";
import {State} from "./index";
import {numberInput} from "./numberInput";

export const stopSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Stop"),
        div(".stop-order-buttons.order-buttons", [
            numberInput("#trigger-price-input", state.triggerPrice),
            button(".sell-button", { attrs: { disabled: stopButtonDisabled(state, "SELL") } }, "Sell"),
            button(".buy-button", { attrs: { disabled: stopButtonDisabled(state, "BUY") } }, "Buy"),
        ]),
    ]);

const stopButtonDisabled = (state: State, side: string): boolean =>
    state.isOrdering
    || state.size === 0
    || state.triggerPrice <= 0
    || state.currentPrice === 0
    || !isValidTriggerPrice(side, state.triggerPrice, state.currentPrice);

const isValidTriggerPrice = (side: string, triggerPrice: number, currentPrice: number): boolean =>
    side === "BUY" ? triggerPrice > currentPrice : triggerPrice < currentPrice;
