import {MainDOMSource} from "@cycle/dom";
import Stream from "xstream";
import {initializeCredentials, saveCredentials} from "../../credentials";
import {soundEnabledStorageKey} from "../../drivers/soundDriver";
import {AccountType, accountTypeStorageKey, defaultAccountType} from "../../models/order";
import {loadStoredValue} from "../../storage";
import {Sources} from "./index";

export interface Actions {
    credentialsMessage$: Stream<string>;
    onAccountTypeChanged$: Stream<AccountType>;
    onAccountTypeLoaded$: Stream<AccountType>;
    onSoundEnabledLoaded$: Stream<boolean>;
    onSoundToggled$: Stream<boolean>;
}

export const intent = (sources: Sources): Actions => {
    const dom = sources.DOM as MainDOMSource;
    const migrationMessage$ = Stream.fromPromise(initializeCredentials())
        .filter((success) => !success)
        .mapTo("Could not migrate legacy credentials. Enter your API key and secret to save them again.");

    const saveMessage$ = dom.select("#credentials-form").events("submit")
        .map((event) => {
            event.preventDefault();
            const form = event.target as HTMLFormElement;
            const key = (form.elements.namedItem("key") as HTMLInputElement).value.trim();
            const secret = (form.elements.namedItem("secret") as HTMLInputElement).value.trim();
            form.reset();
            return key && secret
                ? updateCredentials({ key, secret }, "Credentials saved.")
                : Promise.resolve("Enter both an API key and an API secret.");
        });

    const clearMessage$ = dom.select("#clear-credentials").events("click")
        .map(() => updateCredentials(null, "Credentials cleared."));

    const onSoundEnabledLoaded$ = (sources.storage as any).local.getItem(soundEnabledStorageKey)
        .take(1)
        .map((value: string | null) => value !== "false");

    const onSoundToggled$ = dom.select("#sound-enabled-input")
        .events("change")
        .map((event) => (event.target as HTMLInputElement).checked);

    const onAccountTypeLoaded$ = loadStoredValue(sources.storage, accountTypeStorageKey)
        .take(1)
        .map((value) => value === "corporate" ? "corporate" : defaultAccountType);

    const onAccountTypeChanged$ = dom.select("#account-type-input")
        .events("change")
        .map((event) => (event.target as HTMLSelectElement).value === "corporate" ? "corporate" : defaultAccountType);

    return {
        credentialsMessage$: Stream.merge(migrationMessage$, Stream.merge(saveMessage$, clearMessage$)
            .map((message) => Stream.fromPromise(message)).flatten()),
        onAccountTypeChanged$,
        onAccountTypeLoaded$,
        onSoundEnabledLoaded$,
        onSoundToggled$,
    };
};

const updateCredentials = (pair: { key: string; secret: string } | null, message: string): Promise<string> =>
    saveCredentials(pair).then(
        () => message,
        () => "Could not update credentials. Check that OS credential storage is available and try again.",
    );
