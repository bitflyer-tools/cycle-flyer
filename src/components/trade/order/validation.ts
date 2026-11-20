import {State} from "./index";

export const isValidOrderSize = (state: State): boolean =>
    isPositiveFinite(state.size);

export const isValidLimitOrder = (state: State): boolean =>
    isValidOrderSize(state) && isPositiveFinite(state.price);

export const isValidIFDOCOOrder = (state: State): boolean =>
    isPositiveFinite(state.size) && state.ifdocoOrder.hasValidWidth();

const isPositiveFinite = (value: number): boolean =>
    Number.isFinite(value) && value > 0;
