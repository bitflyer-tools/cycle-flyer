import Stream from "xstream";
import {soundEnabledStorageKey} from "../../drivers/soundDriver";
import {Sources} from "./index";

export interface Actions {
    onApiKeyLoaded$: Stream<string>;
    onApiSecretLoaded$: Stream<string>;
    onApiKeyInputChanged$: Stream<string>;
    onApiSecretInputChanged$: Stream<string>;
    onSoundEnabledLoaded$: Stream<boolean>;
    onSoundToggled$: Stream<boolean>;
}

export const intent = (sources: Sources): Actions => {
    const onApiKeyLoaded$ = (sources.storage as any).local.getItem("api-key")
        .filter((apiKey: string) => apiKey && apiKey !== "")
        .take(1);

    const onApiSecretLoaded$ = (sources.storage as any).local.getItem("api-secret")
        .filter((apiSecret: string) => apiSecret && apiSecret !== "")
        .take(1);

    const onApiKeyInputChanged$ = sources.DOM.select("#api-key-input")
        .events("keyup")
        .map((event) => event.target as HTMLInputElement)
        .map((element) => element.value);

    const onApiSecretInputChanged$ = sources.DOM.select("#api-secret-input")
        .events("keyup")
        .map((event) => event.target as HTMLInputElement)
        .map((element) => element.value);

    const onSoundEnabledLoaded$ = (sources.storage as any).local.getItem(soundEnabledStorageKey)
        .take(1)
        .map((value: string | null) => value !== "false");

    const onSoundToggled$ = sources.DOM.select("#sound-enabled-input")
        .events("change")
        .map((event) => (event.target as HTMLInputElement).checked);

    return {
        onApiKeyInputChanged$,
        onApiKeyLoaded$,
        onApiSecretInputChanged$,
        onApiSecretLoaded$,
        onSoundEnabledLoaded$,
        onSoundToggled$,
    };
};
