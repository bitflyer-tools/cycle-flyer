import {Sources} from "./index";
import {MemoryStream, Stream} from 'xstream';
import {ResponseStream, Response} from "@cycle/http";
import {History} from "./model";
import {Board} from "../../models/board";

export interface Actions {
    onApiKeyLoaded$: Stream<string>;
    onApiSecretLoaded$: Stream<string>;
    onBoardLoaded$: Stream<Board>;
    onBoardSnapshotLoaded$: Stream<Board>;
    onClickAsk$: Stream<number>;
    onClickBid$: Stream<number>;
    onClickClearButton$: Stream<null>;
    onClickClearOrderButton$: Stream<null>;
    onClickGroupSizePlusButton$: Stream<null>;
    onClickGroupSizeMinusButton$: Stream<null>;
    onClickLimitBuyButton$: Stream<null>;
    onClickLimitSellButton$: Stream<null>;
    onClickMarketBuyButton$: Stream<null>;
    onClickMarketSellButton$: Stream<null>;
    onCollateralLoaded$: Stream<number>;
    onExecutionCreated$: Stream<object>;
    onHistoryCreated$: Stream<History>;
    onOrderCreated$: Stream<object>;
    onPositionsLoaded$: Stream<object[]>;
    onPriceChanged$: Stream<number>;
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

    const onBoardLoaded$ = sources.pubnub.board$;

    const onBoardSnapshotLoaded$ = Stream.merge(
        sources.HTTP.select("board")
            .map(response$ => response$.replaceError(() => Stream.of(null)))
            .flatten()
            .filter(response => !!response)
            .map(response => new Board(JSON.parse(response.text))),
        sources.pubnub.boardSnapshot$
            .map(board => new Board(board)),
    );

    const onClickAsk$ = sources.DOM.select(".ask")
        .events("click")
        .map(event => event.currentTarget as HTMLElement)
        .map(target => target.dataset.price);

    const onClickBid$ = sources.DOM.select(".bid")
        .events("click")
        .map(event => event.currentTarget as HTMLElement)
        .map(target => target.dataset.price);

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

    const onCollateralLoaded$ = sources.HTTP.select("collateral")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text).collateral);

    const onExecutionCreated$ = sources.pubnub.execution$;

    const onHistoryCreated$ = Stream.merge(
        sources.HTTP.select("market-order").map(stream => createHistoryStream("MarketOrder", stream)).flatten(),
        sources.HTTP.select("limit-order").map(stream => createHistoryStream("LimitOrder", stream)).flatten()
    );

    const onOrderCreated$ = sources.HTTP.select("market-order")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    const onPriceChanged$ = sources.DOM.select("#price-input")
        .events("keyup")
        .map(event => event.target as HTMLInputElement)
        .map(element => +element.value);

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
        onBoardLoaded$,
        onBoardSnapshotLoaded$,
        onClickAsk$,
        onClickBid$,
        onClickClearButton$,
        onClickClearOrderButton$,
        onClickGroupSizePlusButton$,
        onClickGroupSizeMinusButton$,
        onClickLimitBuyButton$,
        onClickLimitSellButton$,
        onClickMarketBuyButton$,
        onClickMarketSellButton$,
        onCollateralLoaded$,
        onExecutionCreated$,
        onHistoryCreated$,
        onOrderCreated$,
        onPositionsLoaded$,
        onPriceChanged$,
        onSizeChanged$,
        onStateLoaded$
    };
};

const createHistoryStream = (name: string, stream$: MemoryStream<Response> & ResponseStream): Stream<History> => {
    return stream$
        .map(response => {
            const send = JSON.parse(response.request.send);
            return createHistory(name, `${send.side} / ${send.size} / ${send.price || "MARKET"}`, "success");
        })
        .replaceError(error => {
            const send = JSON.parse(error.response.request.send);
            return Stream.of(createHistory(name, `${send.side} / ${send.size} / ${send.price || "MARKET"}`, "failed"));
        })
};

const createHistory = (name: string, description: string, status: string): History =>
    ({
        createdAt: new Date(),
        description: description,
        name: name,
        status: status
    });
