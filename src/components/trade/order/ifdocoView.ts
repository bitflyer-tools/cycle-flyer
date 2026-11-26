import {div, h4, input, label, p, span, VNode} from "@cycle/dom";
import {sideButtons} from "./buttons";
import {State} from "./index";
import {syncValue} from "./numberInput";
import {isValidIFDOCOOrder} from "./validation";

export const ifdocoSection = (state: State): VNode => {
    const size = Math.abs(state.size);
    const hasValidRatio = state.ifdocoOrder.hasValidRatio();
    return div([
        h4(".sub-title", "Ranged IFDOCO"),
        div(".line", hasValidRatio ? [
            p(".line-number", [
                lineNumber("Buy", "+", "-", buyLines(state, size)),
                lineNumber("Sell", "-", "+", sellLines(state, size)),
            ]),
        ] : [p("#ratio-error", "Enter a numeric profit / loss ratio.")]),
        div(".price-width", [
            label(".label", "Price width"),
            input("#price-width-input", { attrs: { value: state.ifdocoOrder.width }}),
        ]),
        div(".ratio", [
            label(".label", { attrs: { for: "ratio-input" } }, "Profit / Loss Ratio"),
            input("#ratio-input", hasValidRatio ? {
                attrs: { value: state.ifdocoOrder.ratio },
                hook: { update: (_: VNode, vnode: VNode) => syncValue(vnode.elm as HTMLInputElement, state.ifdocoOrder.ratio) },
            } : {
                attrs: {
                    "aria-invalid": "true",
                    "aria-describedby": "ratio-error",
                },
            }),
        ]),
        div(".ranged-ifdoco-order-buttons.order-buttons", sideButtons(
            ifdocoButtonDisabled(state, "SELL"),
            ifdocoButtonDisabled(state, "BUY"),
        )),
    ]);
};

interface Lines {
    loss: number;
    lossLine: number;
    profit: number;
    profitLine: number;
}

const lineNumber = (side: string, profitSign: string, lossSign: string, lines: Lines): VNode =>
    p("." + side.toLowerCase(), [
        label(".label." + side.toLowerCase(), side),
        span(".right", [
            span(".profit", profitSign + lines.profit),
            span("/"),
            span(".loss", lossSign + lines.loss),
            span(" ("),
            span(".profit-line", lines.profitLine),
            span("/"),
            span(".loss-line", lines.lossLine),
            span(")"),
        ]),
    ]);

const buyLines = (state: State, size: number): Lines => ({
    loss: state.ifdocoOrder.buyLoss(state.currentPrice, size),
    lossLine: state.ifdocoOrder.buyLossLine(state.currentPrice),
    profit: state.ifdocoOrder.buyProfit(state.currentPrice, size),
    profitLine: state.ifdocoOrder.buyProfitLine(state.currentPrice),
});

const sellLines = (state: State, size: number): Lines => ({
    loss: state.ifdocoOrder.sellLoss(state.currentPrice, size),
    lossLine: state.ifdocoOrder.sellLossLine(state.currentPrice),
    profit: state.ifdocoOrder.sellProfit(state.currentPrice, size),
    profitLine: state.ifdocoOrder.sellProfitLine(state.currentPrice),
});

const ifdocoButtonDisabled = (state: State, side: "BUY" | "SELL"): boolean =>
    state.isOrdering || !isValidIFDOCOOrder(state, side);
