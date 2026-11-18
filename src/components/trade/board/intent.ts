import {Stream} from "xstream";
import {Board} from "../../../models/board";
import {loadNumber} from "../../../storage";
import {Sources} from "../index";
import {pollResponse} from "../pollResponse";

export interface Actions {
    onBoardLoaded$: Stream<Board>;
    onBoardSnapshotLoaded$: Stream<Board>;
    onClickAsk$: Stream<number>;
    onClickBid$: Stream<number>;
    onClickGroupSizePlusButton$: Stream<null>;
    onClickGroupSizeMinusButton$: Stream<null>;
    onGroupSizeLoaded$: Stream<number>;
}

export const groupSizeStorageKey = "board-group-size";

export const intent = (sources: Sources): Actions => {
    const onBoardLoaded$ = sources.socket.board$
        .map((json) => new Board(json));

    const onBoardSnapshotLoaded$ = pollResponse(sources.HTTP.select("board"), (json) =>
        isBoardSide(json?.asks) && isBoardSide(json?.bids) ? new Board(json) : undefined);

    const onClickAsk$ = sources.DOM.select(".ask")
        .events("click")
        .map((event) => event.currentTarget as HTMLElement)
        .map((target) => +target.dataset.price);

    const onClickBid$ = sources.DOM.select(".bid")
        .events("click")
        .map((event) => event.currentTarget as HTMLElement)
        .map((target) => +target.dataset.price);

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
        onClickGroupSizeMinusButton$,
        onClickGroupSizePlusButton$,
        onGroupSizeLoaded$: loadNumber(sources.storage, groupSizeStorageKey),
    };
};

const isBoardSide = (orders: unknown): boolean =>
    Array.isArray(orders) && orders.every((order) =>
        Number.isFinite(order?.price) && Number.isFinite(order?.size));
