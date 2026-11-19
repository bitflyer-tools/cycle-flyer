import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Order} from "../../models/order";
import {createOrderHistory} from "../../models/orderHistory";
import {putParentOrder, retainActive} from "../../models/parentStopOrders";
import {Position} from "../../models/position";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    currentPrice: 0,
    histories: [],
    orders: [],
    parentStopOrders: {},
    position: new Position([]),
    price: 0,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const currentPriceReducer$ = actions.onExecutionBatch$
        .filter((executions) => executions.length > 0)
        .map((executions) => (state: State) => {
            state.boardComponentState?.board.removeExecutions(executions);
            return { ...state, currentPrice: executions[executions.length - 1].price };
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
        .map((id) => (state: State) => {
            const parentStopOrders = { ...state.parentStopOrders };
            delete parentStopOrders[id];
            const canceledParentOrderIds = new Set(state.canceledParentOrderIds).add(id);
            return { ...state, canceledParentOrderIds, parentStopOrders };
        });

    const parentOrdersReducer$ = actions.onParentOrdersLoaded$
        .map((parentOrders) => (state: State) => {
            const activeOrders = parentOrders.filter(({ parent_order_id }) => !state.canceledParentOrderIds?.has(parent_order_id));
            return { ...state, parentStopOrders: retainActive(state.parentStopOrders, activeOrders) };
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
