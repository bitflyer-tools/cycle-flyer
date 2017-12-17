import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Actions} from "./intent";
import {Position} from "../../models/position";
import {Board} from "../../models/board";

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
        actions.onClickClearButton$.mapTo(true),
        actions.onHistoryCreated$.mapTo(false)
    ).map(isOrdering => (state: State) => ({ ...state, isOrdering }));

    const positionsReducer$ = actions.onPositionsLoaded$
        .map(positions => new Position(positions))
        .map(position => (state: State) => ({ ...state, position }));

    const priceReducer$ = Stream.merge(
        actions.onPriceChanged$,
        actions.onClickAsk$.map(price => price - 1),
        actions.onClickBid$.map(price => price + 1)
    ).map(price => (state: State) => ({ ...state, price }));

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
        positionsReducer$,
        priceReducer$,
        sizeReducer$,
        marketStateReducer$
    );
};
