import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Actions} from "./intent";
import throttle from "xstream/extra/throttle";

export interface State {
    collateral: number;
    currentPrice: number;
    position: object;
}

const defaultState: State = {
    collateral: 0.0,
    currentPrice: 0,
    position: { size: 0.0, price: 0.0 }
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
        .map(positions => {
            if (positions.length === 0) {
                return {};
            }
            const side = positions[0].side === "BUY" ? 1 : -1;
            const size = positions.reduce((acc, position) => acc + position.size, 0.0);
            const priceSum = positions.reduce((acc, position) => acc +  position.price * position.size, 0.0);
            const price = Math.floor(priceSum / size);
            return { size: size * side, price };
        })
        .map(position => (state: State) => ({ ...state, position }));

    return Stream.merge(
        defaultReducer$,
        collateralReducer$,
        currentPriceReducer$,
        positionsReducer$
    );
};
