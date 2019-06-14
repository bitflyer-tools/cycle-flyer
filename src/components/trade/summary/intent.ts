import {Stream} from "xstream";
import {OrderHistory} from "../../../models/orderHistory";
import {Sources} from "../index";

export interface Actions {
    onCollateralLoaded$: Stream<number>;
    onHistoryCreated$: Stream<OrderHistory>;
    onPositionsLoaded$: Stream<object[]>;
    onStateLoaded$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onCollateralLoaded$ = sources.HTTP.select("collateral")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .filter((response) => !!response)
        .map((response) => JSON.parse(response.text).collateral);

    const onStateLoaded$ = sources.HTTP.select("status")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .filter((response) => !!response)
        .map((response) => JSON.parse(response.text));

    return {
        onCollateralLoaded$,
        onStateLoaded$,
    } as Actions;
};
