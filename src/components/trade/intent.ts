import {Sources} from "./index";
import {Stream} from 'xstream';

export interface Actions {
    onApiKeyLoaded$: Stream<string>;
    onApiSecretLoaded$: Stream<string>;
    onClickBuyButton$: Stream<null>;
    onClickClearButton$: Stream<null>;
    onClickClearOrderButton$: Stream<null>;
    onClickSellButton$: Stream<null>;
    onCollateralLoaded$: Stream<number>;
    onExecutionCreated$: Stream<object>;
    onPositionsLoaded$: Stream<object[]>;
    onOrderCreated$: Stream<object>;
    onSizeChanged$: Stream<number>;
    onStateLoaded$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onApiKeyLoaded$ = sources.storage.local.getItem("api-key")
        .filter(apiKey => apiKey && apiKey !== "")
        .take(1);

    const onApiSecretLoaded$ = sources.storage.local.getItem("api-secret")
        .filter(apiSecret => apiSecret && apiSecret !== "")
        .take(1);

    const onClickBuyButton$ = sources.DOM.select(".buy-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickClearButton$ = sources.DOM.select(".clear-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickClearOrderButton$ = sources.DOM.select(".clear-order-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickSellButton$ = sources.DOM.select(".sell-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onCollateralLoaded$ = sources.HTTP.select("collateral")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text).collateral);

    const onExecutionCreated$ = sources.pubnub.execution$;

    const onOrderCreated$ = sources.HTTP.select("order")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    const onSizeChanged$ = sources.DOM.select("#size-input")
        .events("keyup")
        .map(event => event.target as HTMLInputElement)
        .map(element => +element.value);

    const onStateLoaded$ = sources.HTTP.select("status")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    return {
        onApiKeyLoaded$,
        onApiSecretLoaded$,
        onClickBuyButton$,
        onClickClearButton$,
        onClickClearOrderButton$,
        onClickSellButton$,
        onCollateralLoaded$,
        onExecutionCreated$,
        onOrderCreated$,
        onPositionsLoaded$,
        onSizeChanged$,
        onStateLoaded$
    };
};
