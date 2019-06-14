import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Position} from "../../../models/position";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    collateral: 0.0,
    currentPrice: 0,
    histories: [],
    marketState: {},
    position: new Position([]),
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const collateralReducer$ = actions.onCollateralLoaded$
        .map((collateral) => (state: State) => ({ ...state, collateral }));

    const marketStateReducer$ = actions.onStateLoaded$
        .map((marketState) => (state: State) => ({ ...state, marketState}));

    return Stream.merge(
        collateralReducer$,
        defaultReducer$,
        marketStateReducer$,
    ) as Stream<Reducer<State>>;
};
