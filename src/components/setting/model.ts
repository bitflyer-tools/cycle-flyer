import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {AccountType, defaultAccountType} from "../../models/order";
import {Actions} from "./intent";

export interface State {
    accountType: AccountType;
    credentialsMessage: string;
    notificationsEnabled: boolean;
    soundEnabled: boolean;
}

const defaultState: State = {
    accountType: defaultAccountType,
    credentialsMessage: "",
    notificationsEnabled: false,
    soundEnabled: true,
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of<Reducer<State>>((state = defaultState) => state);

    const accountTypeReducer$ = Stream.merge(actions.onAccountTypeLoaded$, actions.onAccountTypeChanged$)
        .map<Reducer<State>>((accountType) => (state = defaultState) => ({ ...state, accountType }));

    const credentialsMessageReducer$ = actions.credentialsMessage$
        .startWith("")
        .map<Reducer<State>>((credentialsMessage) => (state = defaultState) => ({ ...state, credentialsMessage }));

    const soundEnabledReducer$ = Stream.merge(actions.onSoundEnabledLoaded$, actions.onSoundToggled$)
        .map<Reducer<State>>((soundEnabled) => (state = defaultState) => ({ ...state, soundEnabled }));

    const notificationsEnabledReducer$ = Stream.merge(
        actions.onNotificationsEnabledLoaded$, actions.onNotificationsToggled$,
    ).map<Reducer<State>>((notificationsEnabled) => (state = defaultState) => ({ ...state, notificationsEnabled }));

    return Stream.merge(
        defaultReducer$, accountTypeReducer$, credentialsMessageReducer$, soundEnabledReducer$,
        notificationsEnabledReducer$,
    );
};
