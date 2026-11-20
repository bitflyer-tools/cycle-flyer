import {State} from "./index";

export const canClearPosition = (state: State): boolean =>
    !state.isOrdering && !state.positionClosePending && state.position.size !== 0;

export const isValidMarketOrder = (state: State): boolean =>
    isPositiveFinite(state.size);

export const isValidLimitOrder = (state: State): boolean =>
    isValidMarketOrder(state) && isPositiveFinite(state.price);

export const isValidIFDOCOOrder = (state: State): boolean =>
    isPositiveFinite(state.size) && state.ifdocoOrder.hasValidWidth();

const isPositiveFinite = (value: number): boolean =>
    Number.isFinite(value) && value > 0;
