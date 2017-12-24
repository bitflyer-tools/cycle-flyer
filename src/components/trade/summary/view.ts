import {div, hr, li, span, ul} from "@cycle/dom";
import Stream from "xstream";
import {State} from "./index";

export const view = (state$: Stream<State>) =>
    state$.map(state =>
        div(".summary", [
            div(".current-price", [
                span(".label", "Current price"),
                span(".number", state.currentPrice.toLocaleString()),
                span(".unit", "JPY")
            ]),
            div(".position", [
                span(".label", "Position"),
                span(".number", state.position.toPriceString()),
                span(".unit", "JPY")
            ]),
            div(".position-diff", [
                span(".label", "Position diff"),
                span(profitDifferenceClass(state), state.position.toDiffString(state.currentPrice)),
                span(".unit", "JPY")
            ]),
            div(".position-size", [
                span(".label", "Position size"),
                span(".number", state.position.toSizeString()),
                span(".unit", "bFX")
            ]),
            div(".profit", [
                span(".label", "Profit / Loss"),
                span(profitClass(state), state.position.toProfitString(state.currentPrice)),
                span(".unit", "JPY")
            ]),
            div(".collateral", [
                span(".label", "Collateral"),
                span(".number", collateralString(state)),
                span(".unit", "JPY")
            ]),
            hr(),
            div(".market-state", [
                span(".label", "Market state"),
                span(healthClass(state.marketState.health), state.marketState.health)
            ]),
            div(".board-state", [
                span(".label", "Board state"),
                span(healthClass(state.marketState.state), state.marketState.state),
            ]),
            hr(),
            ul(".histories", state.histories.map(history =>
                    li(".history", [
                        span(history.status === "success" ? ".success" : ".failed", history.status === "success" ? "○" : "✗"),
                        span(".name", history.name),
                        span(".description", history.description),
                        span(".created-at", history.createdAt.toLocaleTimeString())
                    ])
                )
            )
        ]);

const collateralString = (state: State): string => {
    if (!state.position.price) return state.collateral.toLocaleString();
    const profit = state.position.profit(state.currentPrice);
    return (state.collateral + profit).toLocaleString();
};

const profitClass = (state: State): string => {
    if (!state.position.price) return ".number";
    if (state.position.side === "BUY") {
        return state.currentPrice - state.position.price >= 0.0 ? ".number.plus" : ".number.minus";
    } else {
        return state.currentPrice - state.position.price >= 0.0 ? ".number.minus" : ".number.plus";
    }
};

const profitDifferenceClass = (state: State): string => {
    if (!state.position.price) return ".number";
    return state.currentPrice - state.position.price >= 0.0 ? ".number.plus" : ".number.minus";
};

const healthClass = (health: string): string => {
    if (health === "NORMAL" || health === "RUNNING") {
        return ".health.good";
    } else {
        return ".health.bad";
    }
};
