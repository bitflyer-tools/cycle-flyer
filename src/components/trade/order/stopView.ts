import {button, div, h4, VNode} from "@cycle/dom";
import {State} from "./index";
import {numberInput} from "./numberInput";
import {isValidStopOrder} from "./validation";

export const stopSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Stop"),
        div(".stop-order-buttons.order-buttons", [
            numberInput("#trigger-price-input", state.triggerPrice),
            button(".sell-button", { attrs: { disabled: state.isOrdering || !isValidStopOrder(state, "SELL") } }, "Sell"),
            button(".buy-button", { attrs: { disabled: state.isOrdering || !isValidStopOrder(state, "BUY") } }, "Buy"),
        ]),
    ]);
