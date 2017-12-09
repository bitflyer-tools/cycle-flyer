import {Reducer} from "cycle-onionify";
import Stream from "xstream";

export interface State {
}

const defaultState: State = {
};

export const model = (): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => typeof state === "undefined" ? defaultState : state);

    return Stream.merge(
        defaultReducer$
    );
};