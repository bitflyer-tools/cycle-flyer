import {Reducer} from "@cycle/state";
import {State} from "./index";
import {CancellationOutcome} from "./order/history";

// Trade state survives navigation, so request and cancellation ordering must survive it too.
let parentOrderSequence = 0;

export const nextParentOrderSequence = (): number => ++parentOrderSequence;

export const cancellationReducer = ({ parentOrderId, status }: CancellationOutcome): Reducer<State> => {
    if (status !== "success") return (state) => state;
    if (parentOrderId === null) return (state) => state && { ...state, orders: [] };

    const sequence = nextParentOrderSequence();
    return (state) => {
        if (!state) return state;
        const parentStopOrders = { ...state.parentStopOrders };
        delete parentStopOrders[parentOrderId];
        const canceledParentOrderIds = new Map(state.canceledParentOrderIds).set(parentOrderId, sequence);
        return { ...state, canceledParentOrderIds, parentStopOrders };
    };
};
