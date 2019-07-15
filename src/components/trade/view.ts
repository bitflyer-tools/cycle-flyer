import {button, div, h4, hr, input, label, p, span, VNode} from "@cycle/dom";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {State} from "./index";

export const view = (state$: Stream<State>, boardComponentDOM$: Stream<VNode>, summaryComponentDOM$: Stream<VNode>) =>
    state$
        .compose(sampleCombine(boardComponentDOM$))
        .compose(sampleCombine(summaryComponentDOM$))
        .map(([[state, boardComponentDOM], summaryComponentDOM]) =>
            div(".trade", [
                summaryComponentDOM,
                boardComponentDOM,
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
                        button(".sell-button", { attrs: { disabled: state.isOrdering || state.size === 0 } }, "Sell"),
                        button(".buy-button", { attrs: { disabled: state.isOrdering || state.size === 0 } },"Buy")
                    ]),
                    hr(),
                    h4(".sub-title", "Clear position"),
                    div(".order-buttons", [
                        button(".clear-button", { attrs: { disabled: state.isOrdering || state.position.size === 0 } }, "Clear Position"),
                        button(".clear-order-button", { attrs: { disabled: state.isOrdering || (state.orders.length === 0 && state.stopOrders.length === 0) } }, "Clear Orders"),
                    ]),
                    hr(),
                    h4(".sub-title", "Ranged IFDOCO"),
                    div(".line", [
                        p(".line-number", [
                            p(".buy", [
                                label(".label.buy", "Buy"),
                                span(".right", [
                                    span(".profit", "+" + state.ifdocoOrder.profitDifference()),
                                    span("/"),
                                    span(".loss", "-" + state.ifdocoOrder.lossDifference()),
                                    span(" ("),
                                    span(".profit-line", state.ifdocoOrder.buyProfit(state.currentPrice, state.size)),
                                    span("/"),
                                    span(".loss-line", state.ifdocoOrder.buyLoss(state.currentPrice, state.size)),
                                    span(")")
                                ])
                            ]),
                            p(".sell", [
                                label(".label.sell", "Sell"),
                                span(".right", [
                                    span(".profit", "-" + state.ifdocoOrder.profitDifference()),
                                    span("/"),
                                    span(".loss", "+" + state.ifdocoOrder.lossDifference()),
                                    span(" ("),
                                    span(".profit-line", state.ifdocoOrder.sellProfit(state.currentPrice, state.size)),
                                    span("/"),
                                    span(".loss-line", state.ifdocoOrder.sellLoss(state.currentPrice, state.size)),
                                    span(")")
                                ])
                            ])
                        ]),
                    ]),
                    div(".price-width", [
                        label(".label", "Price width"),
                        input("#price-width-input", { attrs: { value: state.ifdocoOrder.width }})
                    ]),
                    div(".ratio", [
                        label(".label", "Profit / Loss Ratio"),
                        input("#ratio-input", { attrs: { value: state.ifdocoOrder.ratio }})
                    ]),
                    div(".ranged-ifdoco-order-buttons.order-buttons", [
                        button(".sell-button", { attrs: { disabled: state.isOrdering || state.size === 0 || state.ifdocoOrder.width === 0 } }, "Sell"),
                        button(".buy-button", { attrs: { disabled: state.isOrdering || state.size === 0 || state.ifdocoOrder.width === 0 } },"Buy")
                    ]),
                ])
            ])
        );
