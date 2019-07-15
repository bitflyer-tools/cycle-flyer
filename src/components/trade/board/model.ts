import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Board} from "../../../models/board";
import {Position} from "../../../models/position";
import {ceilBy, floorBy} from "../../../util";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    board: new Board({ bids: [], asks: [] }),
    currentPrice: 0,
    groupedSize: 1,
    orders: [],
    position: new Position([]),
    price: 0,
    stopOrders: [],
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const askPriceReducer$ = actions.onClickAsk$
        .map((price) => (state: State) => ({ ...state, price: floorBy(price - 1, state.groupedSize) }));

    const bidPriceReducer$ = actions.onClickBid$
        .map((price) => (state: State) => ({ ...state, price: ceilBy(price + 1, state.groupedSize) }));

    const boardReducer$ = actions.onBoardLoaded$
        .map((board) => (state: State) => ({ ...state, board: state.board.merge(board.asks, board.bids) }));

    const boardSnapshotReducer$ = actions.onBoardSnapshotLoaded$
        .map((board) => (state: State) => ({ ...state, board }));

    const groupSize = [1, 50, 100, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000, 10000, 25000, 50000];

    const groupedSizePlusReducer$ = actions.onClickGroupSizePlusButton$
        .map((_) => (state: State) => {
            const groupedSize = groupSize.filter((size) => size > state.groupedSize)[0] || state.groupedSize;
            return { ...state, groupedSize };
        });

    const groupedSizeMinusReducer$ = actions.onClickGroupSizeMinusButton$
        .map((_) => (state: State) => {
            const groupedSize = groupSize.filter((size) => size < state.groupedSize).slice(-1)[0] || state.groupedSize;
            return { ...state, groupedSize };
        });

    return Stream.merge(
        defaultReducer$,
        askPriceReducer$,
        bidPriceReducer$,
        boardReducer$,
        boardSnapshotReducer$,
        groupedSizeMinusReducer$,
        groupedSizePlusReducer$,
    );
};
