import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {apiCredentials} from "../../credentials";
import {Execution} from "../../models/execution";
import {Order} from "../../models/order";
import {createOrderHistory} from "../../models/orderHistory";
import {putParentOrder, retainActive} from "../../models/parentStopOrders";
import {Position} from "../../models/position";
import {State} from "./index";
import {Actions} from "./intent";
import {checkPriceAlert, isExecutionPrice} from "./priceAlert";

const defaultState: State = {
    currentPrice: null,
    histories: [],
    orders: [],
    parentStopOrders: {},
    position: new Position([]),
    price: 0,
    lastExecutionPrice: 0,
};

export const resetAccountState = (state: State, version: symbol): State => {
    if (state.credentialVersion === version) { return state; }

    const account = { histories: [], orders: [], parentStopOrders: {}, position: new Position([]) };
    const { orderComponentState, summaryComponentState } = state;
    return {
        ...state,
        ...account,
        credentialVersion: version,
        canceledParentOrderIds: undefined,
        positionClose: undefined,
        orderComponentState: orderComponentState && {
            ...orderComponentState,
            ...account,
            isOrdering: false,
            positionClosePending: false,
            twap: { ...orderComponentState.twap, remaining: 0, scheduleId: undefined },
        },
        summaryComponentState: summaryComponentState && {
            ...summaryComponentState,
            histories: account.histories,
            position: account.position,
            collateral: 0,
        },
    };
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const { version } = apiCredentials();
    const defaultReducer$ = Stream.of((state: State) => resetAccountState(startTradeSession(state), version));

    const currentPriceReducer$ = actions.onExecutionBatch$
        .filter((executions) => executions.length > 0)
        .map((executions) => {
            const time = new Date();
            return (state: State) => applyExecutions(state, executions, time);
        });

    const myExecutionReducer$ = actions.onMyExecutionCreated$
        .map((event) => createOrderHistory("Executed", event.side || "", event.size || 0, event.price || 0, "success"))
        .map((history) => (state: State) => ({ ...state, histories: [history].concat(state.histories) }));

    const ordersReducer$ = actions.onOrdersLoaded$
        .map((orders: object[]) => orders.map((order) => new Order(order)))
        .map((orders: Order[]) => (state: State) => ({ ...state, orders }));

    const positionReducer$ = actions.onPositionsLoaded$
        .map(({ position, positionCloseId }) => (state: State) => {
            const close = state.positionClose;
            const reconciled = close?.settled && close.id === positionCloseId
                && (close.rejected || position.size === 0 || (Math.sign(position.size) === Math.sign(close.size)
                    && Math.abs(position.size) < Math.abs(close.size)));
            return { ...state, position, positionClose: reconciled ? undefined : close };
        });

    const cancelParentOrderReducer$ = actions.onCancelParentOrder$
        .map(({ id, sequence }) => (state: State) => {
            const parentStopOrders = { ...state.parentStopOrders };
            delete parentStopOrders[id];
            const canceledParentOrderIds = new Map(state.canceledParentOrderIds).set(id, sequence);
            return { ...state, canceledParentOrderIds, parentStopOrders };
        });

    const parentOrdersReducer$ = actions.onParentOrdersLoaded$
        .map(({ orders, sequence }) => (state: State) => {
            const canceled = state.canceledParentOrderIds;
            if (!canceled?.size) {
                return { ...state, parentStopOrders: retainActive(state.parentStopOrders, orders) };
            }
            const listedIds = new Set(orders.map(({ parent_order_id }) => parent_order_id));
            const canceledParentOrderIds = new Map(Array.from(canceled)
                .filter(([id, canceledAt]) => canceledAt >= sequence || listedIds.has(id)));
            return {
                ...state,
                canceledParentOrderIds,
                parentStopOrders: retainActive(state.parentStopOrders,
                    orders.filter(({ parent_order_id }) => !canceled.has(parent_order_id))),
            };
        });

    const parentOrderReducer$ = actions.onParentOrderLoaded$
        .map((parentOrder) => (state: State) => state.canceledParentOrderIds?.has(parentOrder.parent_order_id)
            ? state
            : { ...state, parentStopOrders: putParentOrder(state.parentStopOrders, parentOrder) });

    return Stream.merge(
        defaultReducer$,
        cancelParentOrderReducer$,
        currentPriceReducer$,
        myExecutionReducer$,
        ordersReducer$,
        positionReducer$,
        parentOrderReducer$,
        parentOrdersReducer$,
    ) as Stream<Reducer<State>>;
};

const startTradeSession = (state: State = defaultState): State => ({
    ...state,
    lastExecutionPrice: 0,
    summaryComponentState: state.summaryComponentState && { ...state.summaryComponentState, priceAlert: null },
});

const applyExecutions = (state: State, executions: Execution[], time: Date): State => {
    state.boardComponentState?.board.removeExecutions(executions.filter(({ price }) => isExecutionPrice(price)));
    return executions.reduce((next, { price }) => applyExecution(next, price, time), state);
};

const applyExecution = (state: State, price: number, time: Date): State => {
    if (!isExecutionPrice(price)) { return { ...state, lastExecutionPrice: 0 }; }

    const summary = state.summaryComponentState;
    const priceAlert = summary && checkPriceAlert(summary.priceAlert, state.lastExecutionPrice, price, time);
    return {
        ...state,
        currentPrice: price,
        lastExecutionPrice: price,
        summaryComponentState: summary && { ...summary, priceAlert: priceAlert ?? null },
    };
};
