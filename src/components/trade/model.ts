import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Order} from "../../models/order";
import {createOrderHistory} from "../../models/orderHistory";
import {flattenStopOrders, ParentStopOrders, putParentOrder, retainActive} from "../../models/parentStopOrders";
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
    stopOrders: [],
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const currentPriceReducer$ = actions.onExecutionCreated$
        .map((execution: any) => (state: State) => {
            if (state.boardComponentState) { state.boardComponentState.board.remove(execution.side, execution.price); }
            return { ...state, currentPrice: execution.price };
        });

    const myExecutionReducer$ = actions.onMyExecutionCreated$
        .map((event) => createOrderHistory("Executed", event.side || "", event.size || 0, event.price || 0, "success"))
        .map((history) => (state: State) => ({ ...state, histories: [history].concat(state.histories) }));

    const ordersReducer$ = actions.onOrdersLoaded$
        .map((orders: object[]) => orders.map((order) => new Order(order)))
        .map((orders: Order[]) => (state: State) => ({ ...state, orders }));

    const positionReducer$ = actions.onPositionsLoaded$
        .map((position) => (state: State) => ({ ...state, position }));

    const parentOrdersReducer$ = actions.onParentOrdersLoaded$
        .map((parentOrders) => (state: State) => withStopOrders(state, retainActive(state.parentStopOrders, parentOrders)));

    const parentOrderReducer$ = actions.onParentOrderLoaded$
        .map((parentOrder) => (state: State) => withStopOrders(state, putParentOrder(state.parentStopOrders, parentOrder)));

    const stopOrdersDeleteReducer$ = actions.onExecutionCreated$
        .map((execution: any) => (state: State) => {
            const stopOrders = state.stopOrders.filter((order) => !order.isExcuted(execution.price));
            return { ...state, stopOrders };
        });

    return Stream.merge(
        defaultReducer$,
        currentPriceReducer$,
        myExecutionReducer$,
        ordersReducer$,
        positionReducer$,
        parentOrderReducer$,
        parentOrdersReducer$,
        stopOrdersDeleteReducer$,
    ) as Stream<Reducer<State>>;
};

const withStopOrders = (state: State, parentStopOrders: ParentStopOrders): State =>
    ({ ...state, parentStopOrders, stopOrders: flattenStopOrders(parentStopOrders) });
