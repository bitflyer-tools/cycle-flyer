import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Actions} from "./intent";

export interface State {
    credentialsMessage: string;
    soundEnabled: boolean;
}

const defaultState: State = {
    credentialsMessage: "",
    soundEnabled: true,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of<Reducer<State>>((state = defaultState) => state);

    const credentialsMessageReducer$ = actions.credentialsMessage$
        .startWith("")
        .map<Reducer<State>>((credentialsMessage) => (state = defaultState) => ({ ...state, credentialsMessage }));

    const soundEnabledReducer$ = Stream.merge(actions.onSoundEnabledLoaded$, actions.onSoundToggled$)
        .map<Reducer<State>>((soundEnabled) => (state = defaultState) => ({ ...state, soundEnabled }));

    return Stream.merge(defaultReducer$, credentialsMessageReducer$, soundEnabledReducer$);
};
