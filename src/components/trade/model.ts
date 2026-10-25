import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Order} from "../../models/order";
import {Position} from "../../models/position";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    currentPrice: 0,
    histories: [],
    orders: [],
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

    const ordersReducer$ = actions.onOrdersLoaded$
        .map((orders: object[]) => orders.map((order) => new Order(order)))
        .map((orders: Order[]) => (state: State) => ({ ...state, orders }));

    const positionReducer$ = actions.onPositionsLoaded$
        .map((position) => (state: State) => ({ ...state, position }));

    const stopOrdersReducer$ = actions.onStopOrdersLoaded$
        .map((stopOrders) => (state: State) => ({ ...state, stopOrders }));

    const stopOrdersDeleteReducer$ = actions.onExecutionCreated$
        .map((execution: any) => (state: State) => {
            const stopOrders = state.stopOrders.filter((order) => !order.isExcuted(execution.price));
            return { ...state, stopOrders };
        });

    return Stream.merge(
        defaultReducer$,
        currentPriceReducer$,
        ordersReducer$,
        positionReducer$,
        stopOrdersReducer$,
        stopOrdersDeleteReducer$,
    ) as Stream<Reducer<State>>;
};
