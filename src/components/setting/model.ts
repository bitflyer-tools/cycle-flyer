import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Actions} from "./intent";

export interface State {
    apiKey: string;
    apiSecret: string;
}

const defaultState: State = {
    apiKey: "",
    apiSecret: "",
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => typeof state === "undefined" ? defaultState : state);

    const apiKeyReducer$ = Stream.merge(actions.onApiKeyLoaded$, actions.onApiKeyInputChanged$)
        .map((apiKey) => (state: State) => ({ ...state, apiKey }));

    const apiSecretReducer$ = Stream.merge(actions.onApiSecretLoaded$, actions.onApiSecretInputChanged$)
        .map((apiSecret) => (state: State) => ({ ...state, apiSecret }));

    return Stream.merge(
        defaultReducer$,
        apiKeyReducer$,
        apiSecretReducer$,
    ) as Stream<Reducer<State>>;
};
