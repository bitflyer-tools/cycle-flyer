import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {isExecutionPrice} from "../../../models/execution";
import {Position} from "../../../models/position";
import {State} from "./index";
import {Actions} from "./intent";
import {checkPriceAlert} from "./priceAlert";

const defaultState: State = {
    collateral: 0.0,
    currentPrice: null,
    histories: [],
    marketState: {},
    position: new Position([]),
    priceAlert: null,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    // A fresh closure per mount, so the crossing baseline forgets any in-flight execution
    // whenever Trade (and therefore this component) is left and re-entered.
    let lastExecutionPrice = 0;

    const startSessionReducer$ = Stream.of((state: State) => state ? { ...state, priceAlert: null } : defaultState);

    const priceAlertReducer$ = actions.onPriceAlertSet$
        .map((level) => (state: State) => state.priceAlert?.status === "active"
            ? state
            : { ...state, priceAlert: { ...level, status: "active" as const } });
    const dismissPriceAlertReducer$ = actions.onPriceAlertDismissed$
        .map(() => (state: State) => ({ ...state, priceAlert: null }));

    const priceAlertCrossingReducer$ = actions.onExecutionBatch$
        .filter((executions) => executions.length > 0)
        .map((executions) => {
            const time = new Date();
            return (state: State) => {
                let priceAlert = state.priceAlert;
                for (const { price } of executions) {
                    if (!isExecutionPrice(price)) {
                        lastExecutionPrice = 0;
                        continue;
                    }
                    priceAlert = checkPriceAlert(priceAlert, lastExecutionPrice, price, time) ?? null;
                    lastExecutionPrice = price;
                }
                return priceAlert === state.priceAlert ? state : { ...state, priceAlert };
            };
        });

    const collateralReducer$ = actions.onCollateralLoaded$
        .map((collateral) => (state: State) => ({ ...state, collateral }));

    const marketStateReducer$ = actions.onStateLoaded$
        .map((marketState) => (state: State) => ({ ...state, marketState}));

    return Stream.merge(
        collateralReducer$,
        startSessionReducer$,
        marketStateReducer$,
        priceAlertReducer$,
        dismissPriceAlertReducer$,
        priceAlertCrossingReducer$,
    ) as Stream<Reducer<State>>;
};
