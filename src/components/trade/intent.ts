import {Sources} from "./index";
import {Stream} from 'xstream';

export interface Actions {
    onApiKeyLoaded$: Stream<string>;
    onApiSecretLoaded$: Stream<string>;
    onCollateralLoaded$: Stream<object>;
    onPositionsLoaded$: Stream<object[]>;
    onExecutionCreated$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onApiKeyLoaded$ = sources.storage.local.getItem("api-key")
        .filter(apiKey => apiKey && apiKey !== "")
        .take(1);

    const onApiSecretLoaded$ = sources.storage.local.getItem("api-secret")
        .filter(apiSecret => apiSecret && apiSecret !== "")
        .take(1);

    const onCollateralLoaded$ = sources.HTTP.select("collateral")
        .flatten()
        .map(response => JSON.parse(response.text).collateral);

    const onExecutionCreated$ = sources.pubnub.execution$;

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .flatten()
        .map(response => JSON.parse(response.text));

    return {
        onApiKeyLoaded$,
        onApiSecretLoaded$,
        onCollateralLoaded$,
        onExecutionCreated$,
        onPositionsLoaded$
    };
};
