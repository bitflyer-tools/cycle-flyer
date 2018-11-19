import {Stream} from 'xstream';
import {Board} from "../../../models/board";
import {Sources} from "../index";

export interface Actions {
    onBoardLoaded$: Stream<Board>;
    onBoardSnapshotLoaded$: Stream<Board>;
    onClickAsk$: Stream<number>;
    onClickBid$: Stream<number>;
    onClickGroupSizePlusButton$: Stream<null>;
    onClickGroupSizeMinusButton$: Stream<null>;
}

export const intent = (sources: Sources): Actions => {
    const onBoardLoaded$ = sources.pubnub.board$;

    const onBoardSnapshotLoaded$ = sources.HTTP.select("board")
            .map(response$ => response$.replaceError(() => Stream.of(null)))
            .flatten()
            .filter(response => !!response)
            .map(response => new Board(JSON.parse(response.text)));

    const onClickAsk$ = sources.DOM.select(".ask")
        .events("click")
        .map(event => event.currentTarget as HTMLElement)
        .map(target => +target.dataset.price);

    const onClickBid$ = sources.DOM.select(".bid")
        .events("click")
        .map(event => event.currentTarget as HTMLElement)
        .map(target => +target.dataset.price);

    const onClickGroupSizePlusButton$ = sources.DOM.select(".board-header").select(".plus")
        .events("click")
        .mapTo(null);

    const onClickGroupSizeMinusButton$ = sources.DOM.select(".board-header").select(".minus")
        .events("click")
        .mapTo(null);

    return {
        onBoardLoaded$,
        onBoardSnapshotLoaded$,
        onClickAsk$,
        onClickBid$,
        onClickGroupSizePlusButton$,
        onClickGroupSizeMinusButton$
    };
};
