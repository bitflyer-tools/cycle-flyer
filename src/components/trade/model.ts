import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {IFDOCOrder} from "../../models/ifdocoOrder";
import {Order} from "../../models/order";
import {Position} from "../../models/position";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    currentPrice: 0,
    histories: [],
    ifdocoOrder: new IFDOCOrder(10000, 50),
    isOrdering: false,
    orders: [],
    position: new Position([]),
    price: 0,
    size: 0,
    stopOrders: [],
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const cancelOrdersReducer$ = actions.onCancelOrders$
        .map((_) => (state: State) => ({ ...state, orders: [], stopOrders: [] }));

    const currentPriceReducer$ = actions.onExecutionCreated$
        .map((execution) => (state: State) => {
            if (state.boardComponentState) { state.boardComponentState.board.remove(execution.side, execution.price); }
            return { ...state, currentPrice: execution.price };
        });

    const historyReducer$ = actions.onHistoryCreated$
        .map((history) => (state: State) => ({ ...state, histories: [history].concat(state.histories)}));

    const isOrderingReducer$ = Stream.merge(
        actions.onClickMarketBuyButton$.mapTo(true),
        actions.onClickMarketSellButton$.mapTo(true),
        actions.onClickLimitBuyButton$.mapTo(true),
        actions.onClickLimitSellButton$.mapTo(true),
        actions.onClickClearButton$.mapTo(true),
        actions.onHistoryCreated$.mapTo(false),
    ).map((isOrdering) => (state: State) => ({ ...state, isOrdering }));

    const ordersReducer$ = actions.onOrdersLoaded$
        .map((orders) => orders.map((order) => new Order(order)))
        .map((orders) => (state: State) => ({ ...state, orders }));

    const positionReducer$ = actions.onPositionsLoaded$
        .map((position) => (state: State) => ({ ...state, position }));

    const priceReducer$ = actions.onPriceChanged$
        .map((price) => (state: State) => ({ ...state, price }));

    const priceWidthReducer$ = actions.onPriceWidthChanged$
        .map((price) => (state: State) => ({ ...state, ifdocoOrder: new IFDOCOrder(price, state.ifdocoOrder.ratio) }));

    const ratioReducer$ = actions.onRatioChanged$
        .map((ratio) => (state: State) => ({ ...state, ifdocoOrder: new IFDOCOrder(state.ifdocoOrder.width, ratio) }));

    const sizeReducer$ = actions.onSizeChanged$
        .map((size) => (state: State) => ({ ...state, size }));

    const stopOrdersReducer$ = actions.onStopOrdersLoaded$
        .map((stopOrders) => (state: State) => ({ ...state, stopOrders }));

    const stopOrdersDeleteReducer$ = actions.onExecutionCreated$
        .map((execution) => (state: State) => {
            const stopOrders = state.stopOrders.filter((order) => !order.isExcuted(execution.price));
            return { ...state, stopOrders };
        });

    return Stream.merge(
        defaultReducer$,
        cancelOrdersReducer$,
        currentPriceReducer$,
        historyReducer$,
        isOrderingReducer$,
        ordersReducer$,
        positionReducer$,
        priceReducer$,
        priceWidthReducer$,
        ratioReducer$,
        sizeReducer$,
        stopOrdersReducer$,
        stopOrdersDeleteReducer$,
    );
};
