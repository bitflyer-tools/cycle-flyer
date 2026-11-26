import {MainDOMSource} from "@cycle/dom";
import Stream from "xstream";
import {initializeCredentials, saveCredentials} from "../../credentials";
import {notificationsEnabledStorageKey} from "../../drivers/notificationDriver";
import {soundEnabledStorageKey} from "../../drivers/soundDriver";
import {Sources} from "./index";

export interface Actions {
    credentialsMessage$: Stream<string>;
    onNotificationsEnabledLoaded$: Stream<boolean>;
    onNotificationsToggled$: Stream<boolean>;
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

    const onNotificationsEnabledLoaded$ = (sources.storage as any).local.getItem(notificationsEnabledStorageKey)
        .take(1)
        .map((value: string | null) => value === "true");

    const onNotificationsToggled$ = dom.select("#notifications-enabled-input")
        .events("change")
        .map((event) => (event.target as HTMLInputElement).checked);

    onNotificationsToggled$.filter((enabled) => enabled).addListener({ next: requestNotificationPermission });

    return {
        credentialsMessage$: Stream.merge(migrationMessage$, Stream.merge(saveMessage$, clearMessage$)
            .map((message) => Stream.fromPromise(message)).flatten()),
        onNotificationsEnabledLoaded$,
        onNotificationsToggled$,
        onSoundEnabledLoaded$,
        onSoundToggled$,
    };
};

// Requesting permission here, in response to the checkbox's own change event, keeps it tied to a user
// gesture; requesting it later when an unrelated notification fires can be silently denied.
const requestNotificationPermission = (): void => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
    }
};

const updateCredentials = (pair: { key: string; secret: string } | null, message: string): Promise<string> =>
    saveCredentials(pair).then(
        () => message,
        () => "Could not update credentials. Check that OS credential storage is available and try again.",
    );
