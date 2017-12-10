import {div, p, span} from "@cycle/dom";
import Stream from "xstream";
import {State} from "./model";

export const view = (state$: Stream<State>) =>
    state$.map(state =>
        div(".trade", [
            div(".collateral", [
                span(".label", "Collateral"),
                span(collateralString(state))
            ]),
            div(".current-price", [
                span(".label", "Current price"),
                span(state.currentPrice.toLocaleString())
            ]),
            div(".position", [
                span(".label", "Position"),
                span(positionString(state))
            ]),
            div(".profit-diff", [
                span(".label", "Profit difference"),
                span(profitClass(state), profitDiffString(state))
            ]),
            div(".profit", [
                span(".label", "Profit"),
                span(profitClass(state), profitString(state))
            ])
        ])
    );

const collateralString = (state): string => {
    if (!state.position.price) return state.collateral.toLocaleString();
    const profit = (state.currentPrice - state.position.price) * state.position.size;
    return (state.collateral + profit).toLocaleString();
};

const positionString = (state): string => {
    if (!state.position.price) return "None";
    return `${state.position.price.toLocaleString()} * ${state.position.size}`
};

const profitDiffString = (state): string => {
    if (!state.position.price) return "None";
    return (state.currentPrice - state.position.price).toLocaleString();
};

const profitString = (state): string => {
    if (!state.position.price) return "None";
    return ((state.currentPrice - state.position.price) * state.position.size).toLocaleString();
};

const profitClass = (state): string => {
    if (!state.position.price) return "";
    return state.currentPrice - state.position.price > 0.0 ? ".plus" : ".minus";
};
