import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Actions} from "./intent";
import {State} from "./index";
import {Board} from "../../../models/board";
import {Position} from "../../../models/position";

const defaultState: State = {
    board: new Board({ bids: [], asks: [] }),
    currentPrice: 0,
    groupedSize: 1,
    orders: [],
    position: new Position([]),
    price: 0
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const askPriceReducer$ = actions.onClickAsk$
        .map(price => (state: State) => ({ ...state, price: floor(price - 1, state) }));

    const bidPriceReducer$ = actions.onClickBid$
        .map(price => (state: State) => ({ ...state, price: ceil(price + 1, state) }));

    const boardReducer$ = actions.onBoardLoaded$
        .map(board => (state: State) => ({ ...state, board: state.board.merge(board.asks, board.bids) }));

    const boardSnapshotReducer$ = actions.onBoardSnapshotLoaded$
        .map(board => (state: State) => ({ ...state, board }));

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

    return Stream.merge(
        defaultReducer$,
        askPriceReducer$,
        bidPriceReducer$,
        boardReducer$,
        boardSnapshotReducer$,
        groupedSizeMinusReducer$,
        groupedSizePlusReducer$
    );
};

const ceil = (price: number, state: State) => Math.ceil(price / state.groupedSize) * state.groupedSize;
const floor = (price: number, state: State) => Math.floor(price / state.groupedSize) * state.groupedSize;