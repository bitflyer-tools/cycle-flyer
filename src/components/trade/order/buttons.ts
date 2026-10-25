import {button, VNode} from "@cycle/dom";

export const sideButtons = (disabled: boolean): VNode[] => [
    button(".sell-button", { attrs: { disabled } }, "Sell"),
    button(".buy-button", { attrs: { disabled } }, "Buy"),
];
