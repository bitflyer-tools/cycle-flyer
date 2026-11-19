import {RequestInput, RequestOptions} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {getOrders, getParentOrders, getPositions} from "../../http";
import {Actions} from "./intent";

export interface PositionRequest extends RequestOptions {
    positionCloseId?: symbol;
}

export const request = (
    actions: Actions, settledCloseId$: Stream<symbol | undefined> = Stream.of<symbol | undefined>(undefined),
): Stream<string | RequestInput | null> => {
    const orders = Stream.periodic(10000).mapTo(getOrders()).startWith(getOrders());
    const parentOrders = Stream.periodic(10000).map(getParentOrders).startWith(getParentOrders());
    const positionPolls$ = Stream.merge(Stream.periodic(10000), actions.onMyOrderChanged$).startWith(null);
    const positions = Stream.merge(
        positionPolls$.compose(sampleCombine(settledCloseId$)).map(([_, id]) => id),
        // The initial poll already samples the current close ID.
        settledCloseId$.drop(1).filter((id) => id !== undefined),
    ).map((positionCloseId): PositionRequest => ({ ...getPositions() as RequestOptions, positionCloseId }));

    const refreshes = actions.onMyOrderChanged$
        .map((_) => Stream.fromArray([getOrders(), getParentOrders()]))
        .flatten();

    return Stream.merge(
        orders,
        parentOrders,
        positions,
        refreshes,
        actions.parentOrderRequests$,
    ) as Stream<string | RequestInput | null>;
};
