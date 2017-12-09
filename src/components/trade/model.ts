import {Reducer} from "cycle-onionify";
import Stream from "xstream";
import {Actions} from "./intent";
import throttle from "xstream/extra/throttle";

export interface State {
    executions: object[];
    currentPrice: number;
}

const defaultState: State = {
    executions: [],
    currentPrice: 0
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => typeof state === "undefined" ? defaultState : state);

    const currentPriceReducer$ = actions.onExecutionCreated$
        .compose(throttle(100))
        .map(execution => execution.price)
        .map(currentPrice => (state: State) => ({ ...state, currentPrice }));

    const executionsReducer$ = actions.onExecutionCreated$
        .fold((acc, execution) => {
            acc.unshift(execution);
            return acc;
        }, [])
        .map(executions => executions.slice(0, 30))
        .map(executions => (state: State) => ({ ...state, executions }));

    return Stream.merge(
        defaultReducer$,
        executionsReducer$,
        currentPriceReducer$
    );
};
