import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Board} from "../../../models/board";
import {Position} from "../../../models/position";
import {ceilBy, floorBy} from "../../../util";
import {State} from "./";
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
        .map((board: Board) => (state: State) => ({ ...state, board }));

    const groupedSizePlusReducer$ = actions.onClickGroupSizePlusButton$
        .map((_) => (state: State) => ({ ...state, groupedSize: plusGroupedSizeFor(state.groupedSize) }));

    const groupedSizeMinusReducer$ = actions.onClickGroupSizeMinusButton$
        .map((_) => (state: State) => ({ ...state, groupedSize: minusGroupedSizeFor(state.groupedSize) }));

    return Stream.merge(
        defaultReducer$,
        askPriceReducer$,
        bidPriceReducer$,
        boardReducer$,
        boardSnapshotReducer$,
        groupedSizeMinusReducer$,
        groupedSizePlusReducer$,
    ) as Stream<Reducer<State>>;
};

const groupSize: number[] = [1, 50, 100, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000, 10000, 25000, 50000];

const plusGroupedSizeFor = (groupingSize: number): number =>
    groupSize.filter((size: number) => size > groupingSize)[0] || groupingSize;

const minusGroupedSizeFor = (groupingSize: number): number =>
    groupSize.filter((size: number) => size < groupingSize).slice(-1)[0] || groupingSize;
