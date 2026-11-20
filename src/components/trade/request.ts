import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getOrders, getParentOrders, getPositions, hasApiCredentials} from "../../http";
import {Actions} from "./intent";

export const request = (actions: Actions): Stream<string | RequestInput | null> => {
    const refreshes$ = Stream.merge(Stream.periodic(10000), actions.onMyOrderChanged$)
        .startWith(null)
        .filter(hasApiCredentials)
        .remember();

    return Stream.merge(
        refreshes$.map(() => Stream.of(getOrders(), getPositions())).flatten(),
        actions.onCancelOrders$.filter(hasApiCredentials).map(() => getOrders()),
        parentOrderRefreshes(refreshes$, actions.onParentOrderListSettled$),
        actions.parentOrderRequests$,
    ) as Stream<string | RequestInput | null>;
};

const parentOrderRefreshes = (refreshes$: Stream<number | null>, settled$: Stream<null>) => {
    let loading = false;
    let refreshQueued = false;

    return Stream.merge(settled$.mapTo(true), refreshes$.mapTo(false))
        .filter((settled) => {
            if (settled) {
                loading = false;
                if (!refreshQueued) { return false; }
                refreshQueued = false;
            }
            if (loading) {
                refreshQueued = true;
                return false;
            }
            loading = hasApiCredentials();
            return loading;
        })
        .map(() => getParentOrders());
};
