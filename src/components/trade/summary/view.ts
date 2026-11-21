import {div, hr, li, span, ul} from "@cycle/dom";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {State} from "./index";
import {priceAlertView} from "./priceAlertView";

export const view = (state$: Stream<State>) => {
    const historyList = createHistoryListView();

    return state$.compose(dropRepeats(sameViewInputs)).map((state) =>
        div(".summary", [
            div(".current-price", [
                span(".label", "Current price"),
                span(".number", state.currentPrice?.toLocaleString() ?? "Pending"),
                span(".unit", "JPY"),
            ]),
            priceAlertView(state.priceAlert),
            div(".position", [
                span(".label", "Position"),
                span(".number", state.position.toPriceString()),
                span(".unit", "JPY"),
            ]),
            div(".position-diff", [
                span(".label", "Position diff"),
                span(profitDifferenceClass(state), state.currentPrice === null ? "Pending" : state.position.toDiffString(state.currentPrice)),
                span(".unit", "JPY"),
            ]),
            div(".position-size", [
                span(".label", "Position size"),
                span(".number", state.position.toSizeString()),
                span(".unit", "bFX"),
            ]),
            div(".profit", [
                span(".label", "Profit / Loss"),
                profitValue(state),
                span(".unit", "JPY"),
            ]),
            div(".collateral", [
                span(".label", "Collateral"),
                span(".number", state.collateral.toLocaleString()),
                span(".unit", "JPY"),
            ]),
            hr(),
            div(".market-state", [
                span(".label", "Market state"),
                span(healthClass(state.marketState.health), state.marketState.health),
            ]),
            div(".board-state", [
                span(".label", "Board state"),
                span(healthClass(state.marketState.state), state.marketState.state),
            ]),
            hr(),
            historyList(state.histories),
        ]));
};

const createHistoryListView = () => {
    let previousHistories: State["histories"] = [];
    let list = ul(".histories", []);

    return (histories: State["histories"]) => {
        if (histories === previousHistories) { return list; }

        previousHistories = histories;
        list = ul(".histories", histories.map((history) =>
            li(".history", [
                span(
                    "." + history.status,
                    historyStatus(history.status, history.timedOut),
                ),
                span(".name", history.name),
                span(".description", history.description),
                span(".created-at", history.createdAt.toLocaleTimeString()),
            ]),
        ));
        return list;
    };
};

const historyStatus = (status: string, timedOut?: boolean): string => {
    if (status === "unconfirmed") return timedOut ? "Unconfirmed (timed out)" : "Unconfirmed";
    return status === "success" ? "○" : "✗";
};

const sameViewInputs = (previous: State, next: State): boolean =>
    Object.is(previous.currentPrice, next.currentPrice)
    && previous.priceAlert === next.priceAlert
    && Object.is(previous.collateral, next.collateral)
    && Object.is(previous.position.price, next.position.price)
    && Object.is(previous.position.size, next.position.size)
    && previous.position.side === next.position.side
    && previous.marketState.health === next.marketState.health
    && previous.marketState.state === next.marketState.state
    && previous.histories === next.histories;

const profitValue = (state: State) => {
    if (state.currentPrice === null) { return span(".number", "Pending"); }
    if (!state.position.price) { return span(".number", "None"); }

    const profit = state.position.profit(state.currentPrice);
    const selector = profit > 0 ? ".number.plus" : profit < 0 ? ".number.minus" : ".number";
    return span(selector, profit.toLocaleString().replace("-", "- "));
};

const profitDifferenceClass = (state: State): string => {
    if (state.currentPrice === null || !state.position.price) { return ".number"; }
    return state.currentPrice - state.position.displayPrice >= 0.0 ? ".number.plus" : ".number.minus";
};

const healthClass = (health: string): string => {
    if (health === "NORMAL" || health === "RUNNING") {
        return ".health.good";
    } else {
        return ".health.bad";
    }
};
