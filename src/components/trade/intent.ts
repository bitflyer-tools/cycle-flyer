import {Sources} from "./index";
import {MemoryStream, Stream} from 'xstream';
import {Response, ResponseStream} from "@cycle/http";
import {createOrderHistory, OrderHistory} from "../../models/orderHistory";
import {Position} from "../../models/position";

export interface Actions {
    onApiKeyLoaded$: Stream<string>;
    onApiSecretLoaded$: Stream<string>;
    onClickClearButton$: Stream<null>;
    onClickClearOrderButton$: Stream<null>;
    onClickGroupSizePlusButton$: Stream<null>;
    onClickGroupSizeMinusButton$: Stream<null>;
    onClickLimitBuyButton$: Stream<null>;
    onClickLimitSellButton$: Stream<null>;
    onClickMarketBuyButton$: Stream<null>;
    onClickMarketSellButton$: Stream<null>;
    onExecutionCreated$: Stream<object>;
    onHistoryCreated$: Stream<OrderHistory>;
    onOrderCreated$: Stream<object>;
    onOrdersLoaded$: Stream<object>;
    onPositionsLoaded$: Stream<object[]>;
    onPriceChanged$: Stream<number>;
    onSizeChanged$: Stream<number>;
}

export const intent = (sources: Sources): Actions => {
    const onApiKeyLoaded$ = sources.storage.local.getItem("api-key")
        .filter(apiKey => apiKey && apiKey !== "")
        .take(1);

    const onApiSecretLoaded$ = sources.storage.local.getItem("api-secret")
        .filter(apiSecret => apiSecret && apiSecret !== "")
        .take(1);

    const onClickClearButton$ = sources.DOM.select(".clear-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickClearOrderButton$ = sources.DOM.select(".clear-order-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickGroupSizePlusButton$ = sources.DOM.select(".board-header").select(".plus")
        .events("click")
        .mapTo(null);

    const onClickGroupSizeMinusButton$ = sources.DOM.select(".board-header").select(".minus")
        .events("click")
        .mapTo(null);

    const onClickMarketBuyButton$ = sources.DOM.select(".market-order-buttons").select(".buy-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickMarketSellButton$ = sources.DOM.select(".market-order-buttons").select(".sell-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickLimitBuyButton$ = sources.DOM.select(".limit-order-buttons").select(".buy-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onClickLimitSellButton$ = sources.DOM.select(".limit-order-buttons").select(".sell-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onExecutionCreated$ = sources.pubnub.execution$;

    const onHistoryCreated$ = Stream.merge(
        sources.HTTP.select("market-order").map(stream => createHistoryStream("Market", stream)).flatten(),
        sources.HTTP.select("limit-order").map(stream => createHistoryStream("Limit", stream)).flatten()
    );

    const onOrderCreated$ = sources.HTTP.select("market-order")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    const onOrdersLoaded$ = sources.HTTP.select("orders")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text))
        .map(positions => new Position(positions));

    const onPriceChanged$ = sources.DOM.select("#price-input")
        .events("keyup")
        .map(event => event.target as HTMLInputElement)
        .map(element => +element.value);

    const onSizeChanged$ = sources.DOM.select("#size-input")
        .events("keyup")
        .map(event => event.target as HTMLInputElement)
        .map(element => +element.value);

    return {
        onApiKeyLoaded$,
        onApiSecretLoaded$,
        onClickClearButton$,
        onClickClearOrderButton$,
        onClickGroupSizePlusButton$,
        onClickGroupSizeMinusButton$,
        onClickLimitBuyButton$,
        onClickLimitSellButton$,
        onClickMarketBuyButton$,
        onClickMarketSellButton$,
        onExecutionCreated$,
        onHistoryCreated$,
        onOrderCreated$,
        onOrdersLoaded$,
        onPositionsLoaded$,
        onPriceChanged$,
        onSizeChanged$,
    };
};

const createHistoryStream = (name: string, stream$: MemoryStream<Response> & ResponseStream): Stream<OrderHistory> =>
    stream$
        .map(response => {
            const send = JSON.parse(response.request.send);
            return createOrderHistory(name, send.side, send.size, send.price, "success");
        })
        .replaceError(error => {
            const send = JSON.parse(error.response.request.send);
            return Stream.of(createOrderHistory(name, send.side, send.size, send.price, "failed"));
        });
