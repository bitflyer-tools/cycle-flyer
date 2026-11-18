import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {PublicExecution} from "../../drivers/socketIODriver";
import {Order} from "../../models/order";
import {createOrderHistory} from "../../models/orderHistory";
import {putParentOrder, retainActive} from "../../models/parentStopOrders";
import {Position} from "../../models/position";
import {State} from "./index";
import {Actions} from "./intent";
import {checkPriceAlert, isExecutionPrice} from "./priceAlert";

const defaultState: State = {
    currentPrice: 0,
    histories: [],
    orders: [],
    parentStopOrders: {},
    position: new Position([]),
    price: 0,
    lastExecutionPrice: 0,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of(startTradeSession);

    const currentPriceReducer$ = actions.onExecutionCreated$
        .map((execution) => {
            const time = new Date();
            return (state: State) => applyExecution(state, execution, time);
        });

    const myExecutionReducer$ = actions.onMyExecutionCreated$
        .map((event) => createOrderHistory("Executed", event.side || "", event.size || 0, event.price || 0, "success"))
        .map((history) => (state: State) => ({ ...state, histories: [history].concat(state.histories) }));

    const ordersReducer$ = actions.onOrdersLoaded$
        .map((orders: object[]) => orders.map((order) => new Order(order)))
        .map((orders: Order[]) => (state: State) => ({ ...state, orders }));

    const positionReducer$ = actions.onPositionsLoaded$
        .map((position) => (state: State) => ({ ...state, position }));

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

const startTradeSession = (state: State = defaultState): State => ({
    ...state,
    lastExecutionPrice: 0,
    summaryComponentState: state.summaryComponentState && { ...state.summaryComponentState, priceAlert: null },
});

const applyExecution = (state: State, { price, side }: PublicExecution, time: Date): State => {
    if (!isExecutionPrice(price)) { return { ...state, lastExecutionPrice: 0 }; }

    state.boardComponentState?.board.remove(side, price);
    const summary = state.summaryComponentState;
    const priceAlert = summary && checkPriceAlert(summary.priceAlert, state.lastExecutionPrice, price, time);
    return {
        ...state,
        currentPrice: price,
        lastExecutionPrice: price,
        summaryComponentState: summary && { ...summary, priceAlert: priceAlert ?? null },
    };
};
