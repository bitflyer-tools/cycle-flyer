import {currentCredentialVersion} from "../../../credentials";
import {isValidOrderSize as meetsOrderSizeMinimum} from "../../../models/order";
import {State} from "./index";

export const canClearPosition = (state: State): boolean =>
    !state.isOrdering && !state.positionClosePending && state.position.size !== 0
    && state.positionCredentialVersion === currentCredentialVersion();

export const isValidOrderSize = (state: State): boolean =>
    meetsOrderSizeMinimum(state.size);

export const isValidLimitOrder = (state: State): boolean =>
    isValidOrderSize(state) && isPositiveFinite(state.price);

export const isValidStopOrder = (state: State, side: "BUY" | "SELL"): boolean => {
    const { triggerPrice, currentPrice } = state;
    return isValidOrderSize(state)
        && isPositiveFinite(triggerPrice) && isPositiveFinite(currentPrice)
        && (side === "BUY" ? triggerPrice > currentPrice : triggerPrice < currentPrice);
};

export const isValidIFDOCOOrder = (state: State, side: "BUY" | "SELL"): boolean => {
    const { currentPrice, ifdocoOrder } = state;
    if (!isValidOrderSize(state) || !isPositiveFinite(currentPrice)
        || !ifdocoOrder.hasValidWidth() || !ifdocoOrder.hasValidRatio()) {
        return false;
    }

    const exitPrices = side === "BUY"
        ? [ifdocoOrder.buyProfitLine(currentPrice), ifdocoOrder.buyLossLine(currentPrice)]
        : [ifdocoOrder.sellProfitLine(currentPrice), ifdocoOrder.sellLossLine(currentPrice)];
    return exitPrices.every(isPositiveFinite);
};

const isPositiveFinite = (value: number): boolean =>
    Number.isFinite(value) && value > 0;
