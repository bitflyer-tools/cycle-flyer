import {State} from "./index";

export const canClearPosition = (state: State): boolean =>
    !state.isOrdering && !state.positionClosePending && state.position.size !== 0;

export const isValidOrderSize = (state: State): boolean =>
    isPositiveFinite(state.size);

export const isValidLimitOrder = (state: State): boolean =>
    isValidOrderSize(state) && isPositiveFinite(state.price);

export const isValidIFDOCOOrder = ({ size, ifdocoOrder }: State): boolean =>
    isPositiveFinite(size) && ifdocoOrder.hasValidWidth() && ifdocoOrder.hasValidRatio();

const isPositiveFinite = (value: number): boolean =>
    Number.isFinite(value) && value > 0;
