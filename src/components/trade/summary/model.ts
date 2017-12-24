import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Actions} from "./intent";
import {Position} from "../../../models/position";
import {State} from "./index";

const defaultState: State = {
    collateral: 0.0,
    currentPrice: 0,
    histories: [],
    position: new Position([]),
    marketState: {}
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const collateralReducer$ = actions.onCollateralLoaded$
        .map(collateral => (state: State) => ({ ...state, collateral }));

    const marketStateReducer$ = actions.onStateLoaded$
        .map(marketState => (state: State) => ({ ...state, marketState}));

    return Stream.merge(
        defaultReducer$,
        collateralReducer$,
        marketStateReducer$
    );
};
