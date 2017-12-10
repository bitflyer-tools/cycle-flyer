import {button, div, h3, input, p, span} from "@cycle/dom";
import Stream from "xstream";
import {State} from "./model";

export const view = (state$: Stream<State>) =>
    state$.map(state =>
        div(".trade", [
            div(".summary", [
                h3(".title", "Summary"),
                div(".collateral", [
                    span(".label", "Collateral"),
                    span(".number", collateralString(state)),
                    span(".unit", "JPY")
                ]),
                div(".current-price", [
                    span(".label", "Current price"),
                    span(".number", state.currentPrice.toLocaleString()),
                    span(".unit", "JPY")
                ]),
                div(".position", [
                    span(".label", "Position"),
                    span(".number", state.position.toString())
                ]),
                div(".position-diff", [
                    span(".label", "Position difference"),
                    span(profitDifferenceClass(state), state.position.toDiffString(state.currentPrice)),
                    span(".unit", "JPY")
                ]),
                div(".profit", [
                    span(".label", "Profit / Loss"),
                    span(profitClass(state), state.position.toProfitString(state.currentPrice)),
                    span(".unit", "JPY")
                ])
            ]),
            div(".order", [
                h3(".title", "Order"),
                div(".size", [
                    input("#size-input"),
                ]),
                div(".order-buttons", [
                    button(".sell-button", "Sell"),
                    button(".buy-button", "Buy")
                ])
            ])
        ])
    );

const collateralString = (state): string => {
    if (!state.position.price) return state.collateral.toLocaleString();
    const profit = state.position.profit(state.currentPrice);
    return (state.collateral + profit).toLocaleString();
};

const profitClass = (state): string => {
    if (!state.position.price) return ".number";
    if (state.position.side === "BUY") {
        return state.currentPrice - state.position.price >= 0.0 ? ".number.plus" : ".number.minus";
    } else {
        return state.currentPrice - state.position.price >= 0.0 ? ".number.minus" : ".number.plus";
    }
};

const profitDifferenceClass = (state): string => {
    if (!state.position.price) return ".number";
    return state.currentPrice - state.position.price >= 0.0 ? ".number.plus" : ".number.minus";
};
