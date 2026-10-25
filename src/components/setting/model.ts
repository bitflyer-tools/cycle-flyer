import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Actions} from "./intent";

export interface State {
    apiKey: string;
    apiSecret: string;
    soundEnabled: boolean;
}

const defaultState: State = {
    apiKey: "",
    apiSecret: "",
    soundEnabled: true,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => typeof state === "undefined" ? defaultState : state);

    const apiKeyReducer$ = Stream.merge(actions.onApiKeyLoaded$, actions.onApiKeyInputChanged$)
        .map((apiKey) => (state: State) => ({ ...state, apiKey }));

    const apiSecretReducer$ = Stream.merge(actions.onApiSecretLoaded$, actions.onApiSecretInputChanged$)
        .map((apiSecret) => (state: State) => ({ ...state, apiSecret }));

    const soundEnabledReducer$ = Stream.merge(actions.onSoundEnabledLoaded$, actions.onSoundToggled$)
        .map((soundEnabled) => (state: State) => ({ ...state, soundEnabled }));

    return Stream.merge(
        defaultReducer$,
        apiKeyReducer$,
        apiSecretReducer$,
        soundEnabledReducer$,
    ) as Stream<Reducer<State>>;
};
