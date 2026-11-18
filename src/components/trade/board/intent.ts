import {Stream} from "xstream";
import {loadNumber} from "../../../storage";
import {Sources} from "../index";

export interface Actions {
    onClickAsk$: Stream<number>;
    onClickBid$: Stream<number>;
    onClickGroupSizePlusButton$: Stream<null>;
    onClickGroupSizeMinusButton$: Stream<null>;
    onGroupSizeLoaded$: Stream<number>;
}

export const groupSizeStorageKey = "board-group-size";

export const intent = (sources: Sources): Actions => {
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
        onClickAsk$,
        onClickBid$,
        onClickGroupSizeMinusButton$,
        onClickGroupSizePlusButton$,
        onGroupSizeLoaded$: loadNumber(sources.storage, groupSizeStorageKey),
    };
};
