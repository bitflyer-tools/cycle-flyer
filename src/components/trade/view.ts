import {button, div, h4, hr, input, span, VNode} from "@cycle/dom";
import Stream from "xstream";
import throttle from "xstream/extra/throttle";
import {BoardOrder} from "../../models/board";
import sampleCombine from "xstream/extra/sampleCombine";
import {State} from "./index";

export const view = (state$: Stream<State>, summaryComponentDOM$: Stream<VNode>) =>
    state$
        .compose(sampleCombine(summaryComponentDOM$))
        .compose(throttle(100))
        .map(([state, summaryComponentDOM]) =>
            div(".trade", [
                summaryComponentDOM,
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
                            myOrder("SELL", state, ask),
                            span(padWithZero(ask.size)),
                            span(ask.price.toLocaleString())
                        ])
                    )),
                    div(".bids", state.board.groupedBids(state.groupedSize).map(bid =>
                        div(".bid", { dataset: { price: bid.price } }, [
                            span(".bar", { style: barStyle(bid.size) } ),
                            span(bid.price.toLocaleString()),
                            span(padWithZero(bid.size)),
                            myOrder("BUY", state, bid)
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
                        button(".sell-button", { attrs: { disabled: state.isOrdering || state.size === 0 } }, "Sell"),
                        button(".buy-button", { attrs: { disabled: state.isOrdering || state.size === 0 } },"Buy")
                    ]),
                    hr(),
                    h4(".sub-title", "Limit"),
                    div(".limit-order-buttons.order-buttons", [
                        input("#price-input", { attrs: { value: state.price }}),
                        button(".sell-button", { attrs: { disabled: state.isOrdering || state.size === 0 || state.currentPrice >= state.price } }, "Sell"),
                        button(".buy-button", { attrs: { disabled: state.isOrdering || state.size === 0 || state.currentPrice <= state.price } },"Buy")
                    ]),
                    hr(),
                    h4(".sub-title", "Clear position"),
                    div(".order-buttons", [
                        button(".clear-button", { attrs: { disabled: state.isOrdering || state.position.size === 0 } }, "Clear Position"),
                        button(".clear-order-button", { attrs: { disabled: state.isOrdering || state.orders.length === 0} }, "Clear Orders"),
                    ])
                ])
            ])
        );

const padWithZero = (number: number): string => number.toFixed(8).toString();

const barStyle = (size: number): object => {
    const s = size / 50 * 100;
    const width = s > 100 ? 100 : s;
    return { width: `${width}%` };
};

const myOrder = (side: string, state: State, order: BoardOrder): VNode => {
    if (side === "SELL") {
        const orders = state.orders
            .filter(o => o.side === "SELL")
            .filter(o => o.ceiledPrice(state.groupedSize) === order.price);

        if (orders.length === 0) { return; }
        return span(".my-order", orders.reduce((acc, order) => acc + order.size, 0).toString())
    } else {
        const orders = state.orders
            .filter(o => o.side === "BUY")
            .filter(o => o.flooredPrice(state.groupedSize) === order.price);

        if (orders.length === 0) { return; }
        return span(".my-order", orders.reduce((acc, order) => acc + order.size, 0).toString())
    }
};