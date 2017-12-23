import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Actions} from "./intent";
import {Position} from "../../models/position";
import {Board} from "../../models/board";
import {Order} from "../../models/order";

export interface History {
    createdAt: Date;
    description: string;
    name: string;
    status: string;
}

export interface State {
    board: Board;
    collateral: number;
    currentPrice: number;
    groupedSize: number;
    histories: History[];
    isOrdering: boolean;
    orders: Order[];
    position: Position;
    price: number;
    size: number;
    marketState: object;
}

const defaultState: State = {
    board: new Board({ bids: [], asks: [] }),
    collateral: 0.0,
    currentPrice: 0,
    groupedSize: 1,
    histories: [],
    isOrdering: false,
    orders: [],
    position: new Position([]),
    price: 0,
    size: 0,
    marketState: {}
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const boardReducer$ = actions.onBoardLoaded$
        .map(board => (state: State) => ({ ...state, board: state.board.merge(board.asks, board.bids) }));

    const boardSnapshotReducer$ = actions.onBoardSnapshotLoaded$
        .map(board => (state: State) => ({ ...state, board }));

    const collateralReducer$ = actions.onCollateralLoaded$
        .map(collateral => (state: State) => ({ ...state, collateral }));

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

    const positionsReducer$ = actions.onPositionsLoaded$
        .map(positions => new Position(positions))
        .map(position => (state: State) => ({ ...state, position }));

    const priceReducer$ = actions.onPriceChanged$
        .map(price => (state: State) => ({ ...state, price }));

    const priceReducer2$ = actions.onClickAsk$
        .map(price => (state: State) => ({ ...state, price: floor(price - 1, state) }));

    const priceReducer3$ = actions.onClickBid$
        .map(price => (state: State) => ({ ...state, price: ceil(price + 1, state) }));

    const sizeReducer$ = actions.onSizeChanged$
        .map(size => (state: State) => ({ ...state, size }));

    const marketStateReducer$ = actions.onStateLoaded$
        .map(marketState => (state: State) => ({ ...state, marketState}));

    return Stream.merge(
        defaultReducer$,
        boardReducer$,
        boardSnapshotReducer$,
        collateralReducer$,
        currentPriceReducer$,
        groupedSizeMinusReducer$,
        groupedSizePlusReducer$,
        historyReducer$,
        isOrderingReducer$,
        ordersReducer$,
        positionsReducer$,
        priceReducer$,
        priceReducer2$,
        priceReducer3$,
        sizeReducer$,
        marketStateReducer$
    );
};

const ceil = (price: number, state: State) => Math.ceil(price / state.groupedSize) * state.groupedSize;
const floor = (price: number, state: State) => Math.floor(price / state.groupedSize) * state.groupedSize;