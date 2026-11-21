import {State} from "./index";

export const canClearPosition = (state: State): boolean =>
    !state.isOrdering && !state.positionClosePending && state.position.size !== 0;

export const isValidOrderSize = (state: State): boolean =>
    isPositiveFinite(state.size);

export const isValidLimitOrder = (state: State): boolean =>
    isValidOrderSize(state) && isPositiveFinite(state.price);

export const isValidStopOrder = (state: State, side: "BUY" | "SELL"): boolean => {
    const { triggerPrice, currentPrice } = state;
    return isValidOrderSize(state)
        && isPositiveFinite(triggerPrice) && isPositiveFinite(currentPrice)
        && (side === "BUY" ? triggerPrice > currentPrice : triggerPrice < currentPrice);
};

export const isValidIFDOCOOrder = (state: State): boolean =>
    isValidOrderSize(state) && isPositiveFinite(state.currentPrice)
    && state.ifdocoOrder.hasValidWidth() && state.ifdocoOrder.hasValidRatio();

const isPositiveFinite = (value: number): boolean =>
    Number.isFinite(value) && value > 0;
