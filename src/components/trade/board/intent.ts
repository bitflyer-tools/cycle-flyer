import {MainDOMSource} from "@cycle/dom";
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
    const dom = sources.DOM as MainDOMSource;
    const onClickAsk$ = dom.select(".ask")
        .events("click")
        .map((event) => event.currentTarget as HTMLElement)
        .map((target) => Number(target.dataset.price));

    const onClickBid$ = dom.select(".bid")
        .events("click")
        .map((event) => event.currentTarget as HTMLElement)
        .map((target) => Number(target.dataset.price));

    const onClickGroupSizePlusButton$ = dom.select(".board-header").select(".plus")
        .events("click")
        .mapTo(null);

    const onClickGroupSizeMinusButton$ = dom.select(".board-header").select(".minus")
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
