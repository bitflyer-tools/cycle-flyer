import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Position} from "../../../models/position";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    collateral: 0.0,
    currentPrice: null,
    histories: [],
    marketState: {},
    position: new Position([]),
    priceAlert: null,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const priceAlertReducer$ = actions.onPriceAlertSet$
        .map((level) => (state: State) => state.priceAlert?.status === "active"
            ? state
            : { ...state, priceAlert: { ...level, status: "active" as const } });
    const dismissPriceAlertReducer$ = actions.onPriceAlertDismissed$
        .map(() => (state: State) => ({ ...state, priceAlert: null }));

    const collateralReducer$ = actions.onCollateralLoaded$
        .map((collateral) => (state: State) => ({ ...state, collateral }));

    const marketStateReducer$ = actions.onStateLoaded$
        .map((marketState) => (state: State) => ({ ...state, marketState}));

    return Stream.merge(
        collateralReducer$,
        defaultReducer$,
        marketStateReducer$,
        priceAlertReducer$,
        dismissPriceAlertReducer$,
    ) as Stream<Reducer<State>>;
};
