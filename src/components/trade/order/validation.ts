import {State} from "./index";

export const isValidMarketOrder = (state: State): boolean =>
    isPositiveFinite(state.size);

export const isValidLimitOrder = (state: State): boolean =>
    isValidMarketOrder(state) && isPositiveFinite(state.price);

export const isValidIFDOCOOrder = ({ ifdocoOrder }: State): boolean =>
    ifdocoOrder.hasValidWidth() && ifdocoOrder.hasValidRatio();

const isPositiveFinite = (value: number): boolean =>
    Number.isFinite(value) && value > 0;
