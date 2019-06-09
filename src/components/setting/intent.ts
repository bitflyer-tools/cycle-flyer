import Stream from "xstream";
import {Sources} from "./index";

export interface Actions {
    onApiKeyLoaded$: Stream<string>;
    onApiSecretLoaded$: Stream<string>;
    onApiKeyInputChanged$: Stream<string>;
    onApiSecretInputChanged$: Stream<string>;
}

export const intent = (sources: Sources): Actions => {
    const onApiKeyLoaded$ = sources.storage.local.getItem("api-key")
        .filter((apiKey) => apiKey && apiKey !== "")
        .take(1);

    const onApiSecretLoaded$ = sources.storage.local.getItem("api-secret")
        .filter((apiSecret) => apiSecret && apiSecret !== "")
        .take(1);

    const onApiKeyInputChanged$ = sources.DOM.select("#api-key-input")
        .events("keyup")
        .map((event) => event.target as HTMLInputElement)
        .map((element) => element.value);

    const onApiSecretInputChanged$ = sources.DOM.select("#api-secret-input")
        .events("keyup")
        .map((event) => event.target as HTMLInputElement)
        .map((element) => element.value);

    return {
        onApiKeyInputChanged$,
        onApiKeyLoaded$,
        onApiSecretInputChanged$,
        onApiSecretLoaded$,
    };
};
