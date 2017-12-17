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
    histories: History[];
    isOrdering: boolean;
    position: Position;
    size: number;
    marketState: object;
}

const defaultState: State = {
    board: new Board({ bids: [], asks: [] }),
    collateral: 0.0,
    currentPrice: 0,
    histories: [],
    isOrdering: false,
    position: new Position([]),
    size: 0,
    marketState: {}
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => typeof state === "undefined" ? defaultState : state);

    const boardReducer$ = actions.onBoardLoaded$
        .map(board => (state: State) => {
            if (!state || !state.board) { return; }

            const oldBoard = state.board;
            const asksToRemove = board.asks.map(ask => ask.price);
            const asksToAppend = board.asks.filter(ask => ask.size != 0.0);
            const bidsToRemove = board.bids.map(bid => bid.price);
            const bidsToAppend = board.bids.filter(bid => bid.size != 0.0);

            oldBoard!.asks = oldBoard!.asks
                .filter(ask => !asksToRemove.reduce((previous: boolean, price: number) => previous || price === ask.price, false))
                .concat(asksToAppend)
                .sort((a, b) => a.price < b.price ? -1 : 1);

            oldBoard!.bids = oldBoard!.bids
                .filter(bid => !bidsToRemove.reduce((previous: boolean, price: number) => previous || price === bid.price, false))
                .concat(bidsToAppend)
                .sort((a, b) => a.price > b.price ? -1 : 1);

            return { ...state, board: oldBoard }
        });

    const boardSnapshotReducer$ = actions.onBoardSnapshotLoaded$
        .map(board => (state: State) => ({ ...state, board }));

    const collateralReducer$ = actions.onCollateralLoaded$
        .map(collateral => (state: State) => ({ ...state, collateral }));

    const currentPriceReducer$ = actions.onExecutionCreated$
        .map(execution => (state: State) => {
            state.board.remove(execution.side, execution.price);
            return { ...state, currentPrice: execution.price };
        });

    const historyReducer$ = actions.onHistoryCreated$
        .map(history => (state: State) => ({ ...state, histories: [history].concat(state.histories)}));

    const isOrderingReducer$ = Stream.merge(
        actions.onClickSellButton$.mapTo(true),
        actions.onClickSellButton$.mapTo(true),
        actions.onClickClearButton$.mapTo(true),
        actions.onHistoryCreated$.mapTo(false)
    ).map(isOrdering => (state: State) => ({ ...state, isOrdering }));

    const positionsReducer$ = actions.onPositionsLoaded$
        .map(positions => new Position(positions))
        .map(position => (state: State) => ({ ...state, position }));

    const sizeReducer$ = actions.onSizeChanged$
        .map(size => (state: State) => ({ ...state, size}));

    const marketStateReducer$ = actions.onStateLoaded$
        .map(marketState => (state: State) => ({ ...state, marketState}));

    return Stream.merge(
        defaultReducer$,
        boardReducer$,
        boardSnapshotReducer$,
        collateralReducer$,
        currentPriceReducer$,
        historyReducer$,
        isOrderingReducer$,
        positionsReducer$,
        sizeReducer$,
        marketStateReducer$
    );
};
