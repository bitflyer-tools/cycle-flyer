import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Actions} from "./intent";
import {Board} from "../../models/board";
import {Order} from "../../models/order";
import {State} from "./index";
import {Position} from "../../models/position";

const defaultState: State = {
    board: new Board({ bids: [], asks: [] }),
    currentPrice: 0,
    groupedSize: 1,
    histories: [],
    isOrdering: false,
    orders: [],
    position: new Position([]),
    price: 0,
    size: 0
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const boardReducer$ = actions.onBoardLoaded$
        .map(board => (state: State) => ({ ...state, board: state.board.merge(board.asks, board.bids) }));

    const boardSnapshotReducer$ = actions.onBoardSnapshotLoaded$
        .map(board => (state: State) => ({ ...state, board }));

    const currentPriceReducer$ = actions.onExecutionCreated$
        .map(execution => (state: State) => {
            state.board.remove(execution.side, execution.price);
            return { ...state, currentPrice: execution.price };
        });

    const groupSize = [1, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000];

    const groupedSizePlusReducer$ = actions.onClickGroupSizePlusButton$
        .map(_ => (state: State) => {
            const groupedSize = groupSize.filter(size => size > state.groupedSize)[0] || state.groupedSize;
            return { ...state, groupedSize };
        });

    const groupedSizeMinusReducer$ = actions.onClickGroupSizeMinusButton$
        .map(_ => (state: State) => {
            const groupedSize = groupSize.filter(size => size < state.groupedSize).slice(-1)[0] || state.groupedSize;
            return { ...state, groupedSize };
        });

    const historyReducer$ = actions.onHistoryCreated$
        .map(history => (state: State) => ({ ...state, histories: [history].concat(state.histories)}));

    const isOrderingReducer$ = Stream.merge(
        actions.onClickMarketBuyButton$.mapTo(true),
        actions.onClickMarketSellButton$.mapTo(true),
        actions.onClickLimitBuyButton$.mapTo(true),
        actions.onClickLimitSellButton$.mapTo(true),
        actions.onClickClearButton$.mapTo(true),
        actions.onHistoryCreated$.mapTo(false)
    ).map(isOrdering => (state: State) => ({ ...state, isOrdering }));

    const ordersReducer$ = actions.onOrdersLoaded$
        .map(orders => orders.map(order => new Order(order)))
        .map(orders => (state: State) => ({ ...state, orders }));

    const positionReducer$ = actions.onPositionsLoaded$
        .map(position => (state: State) => ({ ...state, position }));

    const priceReducer$ = actions.onPriceChanged$
        .map(price => (state: State) => ({ ...state, price }));

    const priceReducer2$ = actions.onClickAsk$
        .map(price => (state: State) => ({ ...state, price: floor(price - 1, state) }));

    const priceReducer3$ = actions.onClickBid$
        .map(price => (state: State) => ({ ...state, price: ceil(price + 1, state) }));

    const sizeReducer$ = actions.onSizeChanged$
        .map(size => (state: State) => ({ ...state, size }));

    return Stream.merge(
        defaultReducer$,
        boardReducer$,
        boardSnapshotReducer$,
        currentPriceReducer$,
        groupedSizeMinusReducer$,
        groupedSizePlusReducer$,
        historyReducer$,
        isOrderingReducer$,
        ordersReducer$,
        positionReducer$,
        priceReducer$,
        priceReducer2$,
        priceReducer3$,
        sizeReducer$
    );
};

const ceil = (price: number, state: State) => Math.ceil(price / state.groupedSize) * state.groupedSize;
const floor = (price: number, state: State) => Math.floor(price / state.groupedSize) * state.groupedSize;