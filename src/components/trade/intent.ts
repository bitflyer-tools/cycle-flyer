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
    onClickBuyButton$: Stream<null>;
    onClickClearButton$: Stream<null>;
    onClickClearOrderButton$: Stream<null>;
    onClickGroupSizePlusButton$: Stream<null>;
    onClickGroupSizeMinusButton$: Stream<null>;
    onClickSellButton$: Stream<null>;
    onCollateralLoaded$: Stream<number>;
    onExecutionCreated$: Stream<object>;
    onHistoryCreated$: Stream<History>;
    onOrderCreated$: Stream<object>;
    onPositionsLoaded$: Stream<object[]>;
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

    const onClickBuyButton$ = sources.DOM.select(".buy-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

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

    const onClickSellButton$ = sources.DOM.select(".sell-button")
        .events("click", { preventDefault: true })
        .mapTo(null);

    const onCollateralLoaded$ = sources.HTTP.select("collateral")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text).collateral);

    const onExecutionCreated$ = sources.pubnub.execution$;

    const onHistoryCreated$ = Stream.merge(
        sources.HTTP.select("order").map(createHistoryStream).flatten()
    );

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
        onBoardLoaded$,
        onBoardSnapshotLoaded$,
        onClickBuyButton$,
        onClickClearButton$,
        onClickClearOrderButton$,
        onClickGroupSizePlusButton$,
        onClickGroupSizeMinusButton$,
        onClickSellButton$,
        onCollateralLoaded$,
        onExecutionCreated$,
        onHistoryCreated$,
        onOrderCreated$,
        onPositionsLoaded$,
        onSizeChanged$,
        onStateLoaded$
    };
};

const createHistoryStream = (stream$: MemoryStream<Response> & ResponseStream): Stream<History> => {
    return stream$
        .map(response => {
            const send = JSON.parse(response.request.send);
            return {
                createdAt: new Date(),
                description: `${send.side}: ${send.size}`,
                name: "MarketOrder",
                status: "success"
            }
        })
        .replaceError(error => {
            const send = JSON.parse(error.response.request.send);
            return Stream.of({
                createdAt: new Date(),
                description: `${send.side}: ${send.size}`,
                name: "MarketOrder",
                status: "failed"
            });
        })
};
