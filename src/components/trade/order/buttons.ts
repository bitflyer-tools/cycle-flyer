import {button, VNode} from "@cycle/dom";

export const sideButtons = (sellDisabled: boolean, buyDisabled = sellDisabled): VNode[] => [
    button(".sell-button", { attrs: { disabled: sellDisabled } }, "Sell"),
    button(".buy-button", { attrs: { disabled: buyDisabled } }, "Buy"),
];
