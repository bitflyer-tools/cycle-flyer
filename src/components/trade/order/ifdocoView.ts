import {div, h4, input, label, p, span, VNode} from "@cycle/dom";
import {sideButtons} from "./buttons";
import {State} from "./index";
import {isValidIFDOCOOrder} from "./validation";

export const ifdocoSection = (state: State): VNode => {
    const size = Math.abs(state.size);
    return div([
        h4(".sub-title", "Ranged IFDOCO"),
        div(".line", [
            p(".line-number", [
                lineNumber("Buy", "+", "-", buyLines(state, size)),
                lineNumber("Sell", "-", "+", sellLines(state, size)),
            ]),
        ]),
        div(".price-width", [
            label(".label", "Price width"),
            input("#price-width-input", { attrs: { value: state.ifdocoOrder.width }}),
        ]),
        div(".ratio", [
            label(".label", "Profit / Loss Ratio"),
            input("#ratio-input", { attrs: { value: state.ifdocoOrder.ratio }}),
        ]),
        div(".ranged-ifdoco-order-buttons.order-buttons", sideButtons(ifdocoButtonDisabled(state))),
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
    loss: state.ifdocoOrder.lossDifference(),
    lossLine: state.ifdocoOrder.buyLoss(state.currentPrice, size),
    profit: state.ifdocoOrder.profitDifference(),
    profitLine: state.ifdocoOrder.buyProfit(state.currentPrice, size),
});

const sellLines = (state: State, size: number): Lines => ({
    loss: state.ifdocoOrder.lossDifference(),
    lossLine: state.ifdocoOrder.sellLoss(state.currentPrice, size),
    profit: state.ifdocoOrder.profitDifference(),
    profitLine: state.ifdocoOrder.sellProfit(state.currentPrice, size),
});

const ifdocoButtonDisabled = (state: State): boolean =>
    state.isOrdering || state.size === 0 || !isValidIFDOCOOrder(state);
