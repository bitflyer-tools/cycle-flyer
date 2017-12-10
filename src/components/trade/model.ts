import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import throttle from "xstream/extra/throttle";
import {Actions} from "./intent";
import {Position} from "../../models/position";

export interface State {
    collateral: number;
    currentPrice: number;
    position: Position;
}

const defaultState: State = {
    collateral: 0.0,
    currentPrice: 0,
    position: new Position([])
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => typeof state === "undefined" ? defaultState : state);

    const collateralReducer$ = actions.onCollateralLoaded$
        .map(collateral => (state: State) => ({ ...state, collateral }));

    const currentPriceReducer$ = actions.onExecutionCreated$
        .compose(throttle(100))
        .map(execution => execution.price)
        .map(currentPrice => (state: State) => ({ ...state, currentPrice }));

    const positionsReducer$ = actions.onPositionsLoaded$
        .map(positions => new Position(positions))
        .map(position => (state: State) => ({ ...state, position }));

    return Stream.merge(
        defaultReducer$,
        collateralReducer$,
        currentPriceReducer$,
        positionsReducer$
    );
};
