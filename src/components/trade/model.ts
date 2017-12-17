import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import throttle from "xstream/extra/throttle";
import {Actions} from "./intent";
import {Position} from "../../models/position";

export interface History {
    createdAt: Date;
    description: string;
    name: string;
    status: string;
}

export interface State {
    collateral: number;
    currentPrice: number;
    histories: History[];
    isOrdering: boolean;
    position: Position;
    size: number;
    marketState: object;
}

const defaultState: State = {
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

    const collateralReducer$ = actions.onCollateralLoaded$
        .map(collateral => (state: State) => ({ ...state, collateral }));

    const currentPriceReducer$ = actions.onExecutionCreated$
        .compose(throttle(100))
        .map(execution => execution.price)
        .map(currentPrice => (state: State) => ({ ...state, currentPrice }));

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
        collateralReducer$,
        currentPriceReducer$,
        historyReducer$,
        isOrderingReducer$,
        positionsReducer$,
        sizeReducer$,
        marketStateReducer$
    );
};
