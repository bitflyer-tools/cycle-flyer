import {Stream} from 'xstream';
import {Sources} from "../index";
import {OrderHistory} from "../../../models/orderHistory";

export interface Actions {
    onCollateralLoaded$: Stream<number>;
    onHistoryCreated$: Stream<OrderHistory>;
    onPositionsLoaded$: Stream<object[]>;
    onStateLoaded$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onCollateralLoaded$ = sources.HTTP.select("collateral")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text).collateral);

    const onStateLoaded$ = sources.HTTP.select("status")
        .map(response$ => response$.replaceError(() => Stream.of(null)))
        .flatten()
        .filter(response => !!response)
        .map(response => JSON.parse(response.text));

    return {
        onCollateralLoaded$,
        onStateLoaded$
    };
};
