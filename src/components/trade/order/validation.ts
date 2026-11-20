import {State} from "./index";

export const isValidMarketOrder = (state: State): boolean =>
    isPositiveFinite(state.size);

export const isValidLimitOrder = (state: State): boolean =>
    isValidMarketOrder(state) && isPositiveFinite(state.price);

export const isValidIFDOCOOrder = ({ size, ifdocoOrder }: State): boolean =>
    isPositiveFinite(size) && ifdocoOrder.hasValidWidth() && ifdocoOrder.hasValidRatio();

const isPositiveFinite = (value: number): boolean =>
    Number.isFinite(value) && value > 0;
