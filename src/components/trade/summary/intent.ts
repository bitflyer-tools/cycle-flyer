import {Stream} from "xstream";
import {OrderHistory} from "../../../models/orderHistory";
import {Sources} from "../index";
import {pollResponse} from "../pollResponse";
import {privateResponses} from "../privateResponses";

export interface Actions {
    onCollateralLoaded$: Stream<number>;
    onHistoryCreated$: Stream<OrderHistory>;
    onPositionsLoaded$: Stream<object[]>;
    onStateLoaded$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onCollateralLoaded$ = pollResponse<number>(privateResponses(sources.HTTP, "collateral"), (json) =>
        Number.isFinite(json?.collateral) ? json.collateral : undefined);

    const onStateLoaded$ = pollResponse<object>(sources.HTTP.select("status"), (json) =>
        typeof json?.health === "string" && typeof json.state === "string" ? json : undefined);

    return {
        onCollateralLoaded$,
        onStateLoaded$,
    } as Actions;
};
