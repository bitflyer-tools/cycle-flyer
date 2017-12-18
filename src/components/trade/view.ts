import {button, div, h4, hr, input, li, span, ul} from "@cycle/dom";
import Stream from "xstream";
import {State} from "./model";
import throttle from "xstream/extra/throttle";
import {BoardOrder} from "../../models/board";

export const view = (state$: Stream<State>) =>
    state$.compose(throttle(100)).map(state =>
        div(".trade", [
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
            ]),
            div(".board", [
                div(".board-header",[
                    span("Group"),
                    button(".minus", "-"),
                    span(".grouped-size", state.groupedSize),
                    button(".plus", "+"),
                    span("Spread"),
                    span(".spread", state.board.spread().toLocaleString())
                ]),
                div(".asks", state.board.groupedAsks(state.groupedSize).map(ask =>
                    div(".ask", { dataset: { price: ask.price } }, [
                        span(".bar", { style: barStyle(ask.size) }),
                        myOrder("ask", state, ask),
                        span(padWithZero(ask.size)),
                        span(ask.price.toLocaleString())
                    ])
                )),
                div(".bids", state.board.groupedBids(state.groupedSize).map(bid =>
                    div(".bid", { dataset: { price: bid.price } }, [
                        span(".bar", { style: barStyle(bid.size) } ),
                        span(bid.price.toLocaleString()),
                        span(padWithZero(bid.size)),
                        myOrder("bid", state, bid)
                    ])
                ))
            ]),
            div(".order", [
                h4(".sub-title", "Size"),
                div(".size", [
                    input("#size-input", { attrs: { value: state.size }}),
                ]),
                hr(),
                h4(".sub-title", "Market"),
                div(".market-order-buttons.order-buttons", [
                    button(".sell-button", { attrs: { disabled: state.isOrdering } }, "Sell"),
                    button(".buy-button", { attrs: { disabled: state.isOrdering } },"Buy")
                ]),
                hr(),
                h4(".sub-title", "Limit"),
                div(".limit-order-buttons.order-buttons", [
                    input("#price-input", { attrs: { value: state.price }}),
                    button(".sell-button", { attrs: { disabled: state.isOrdering } }, "Sell"),
                    button(".buy-button", { attrs: { disabled: state.isOrdering } },"Buy")
                ]),
                hr(),
                h4(".sub-title", "Clear position"),
                div(".order-buttons", [
                    button(".clear-button", { attrs: { disabled: state.isOrdering } }, "Clear Position"),
                    button(".clear-order-button", { attrs: { disabled: state.isOrdering } }, "Clear Orders"),
                ])
            ])
        ])
    );

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

const padWithZero = (number: number): string => number.toFixed(8).toString();

const barStyle = (size: number): object => {
    const s = size / 20 * 100;
    const width = s > 100 ? 100 : s;
    return { width: `${width}%` };
};

const myOrder = (side: string, state: State, order: BoardOrder): VNode => {
    if (side === "ask") {
        const orders = state.orders.filter(o => o.ceiledPrice(state.groupedSize) === order.price);
        if (orders.length <= 0) { return span({ style: { display: "none" } }); }
        return span(".my-order", orders.reduce((acc, order) => acc + order.size, 0).toString())
    } else {
        const orders = state.orders.filter(o => o.flooredPrice(state.groupedSize) === order.price);
        if (orders.length <= 0) { return span({ style: { display: "none" } }); }
        return span(".my-order", orders.reduce((acc, order) => acc + order.size, 0).toString())
    }
};