import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Execution, isExecutionPrice} from "../../models/execution";
import {Order} from "../../models/order";
import {createOrderHistory, prependOrderHistory} from "../../models/orderHistory";
import {putParentOrder, retainActive} from "../../models/parentStopOrders";
import {Position} from "../../models/position";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    currentPrice: null,
    histories: [],
    orders: [],
    parentStopOrders: {},
    position: new Position([]),
    positionStale: true,
    price: 0,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of(startTradeSession);

    const currentPriceReducer$ = actions.onExecutionBatch$
        .filter((executions) => executions.length > 0)
        .map((executions) => (state: State) => applyExecutions(state, executions));

    const myExecutionReducer$ = actions.onMyExecutionCreated$
        .map((event) => createOrderHistory("Executed", event.side || "", event.size || 0, event.price || 0, "success"))
        .map((history) => (state: State) => ({ ...state, histories: prependOrderHistory(state.histories, history) }));

    const ordersReducer$ = actions.onOrdersLoaded$
        .map((orders: object[]) => orders.map((order) => new Order(order)))
        .map((orders: Order[]) => (state: State) => ({ ...state, orders }));

    const positionReducer$ = actions.onPositionsLoaded$
        .map(({ position, positionCloseId, positionCredentialVersion }) => (state: State) => {
            const close = state.positionClose;
            const reconciled = close?.settled && close.id === positionCloseId
                && (close.rejected || position.size === 0 || position.size * close.size < 0
                    || Math.abs(position.size) < Math.abs(close.size));
            return {
                ...state, position, positionCredentialVersion, positionStale: false,
                positionClose: reconciled ? undefined : close,
            };
        });

    const positionStaleReducer$ = actions.onPositionsRefreshFailed$
        .map(() => (state: State) => ({ ...state, positionStale: true }));

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
        currentPriceReducer$,
        myExecutionReducer$,
        ordersReducer$,
        positionReducer$,
        positionStaleReducer$,
        parentOrderReducer$,
        parentOrdersReducer$,
    ) as Stream<Reducer<State>>;
};

const startTradeSession = (state: State = defaultState): State => ({
    ...state,
    currentPrice: null,
});

const applyExecutions = (state: State, executions: Execution[]): State => {
    let currentPrice = state.currentPrice;

    for (const { price } of executions) {
        if (isExecutionPrice(price)) {
            currentPrice = price;
        }
    }

    return { ...state, currentPrice };
};
