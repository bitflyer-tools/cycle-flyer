import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {credentialAvailability, currentCredentialVersion, hasApiCredentials} from "../../credentials";
import {AccountRequest} from "../../drivers/httpDriver";
import {getOrders, getParentOrders, getPositions} from "../../http";
import {Actions} from "./intent";

export interface PositionRequest extends AccountRequest {
    positionCloseId?: symbol;
}

export const request = (
    actions: Actions, settledCloseId$: Stream<symbol | undefined> = Stream.of<symbol | undefined>(undefined),
): Stream<string | RequestInput | null> => {
    const refreshes$ = Stream.merge(Stream.periodic(10000), actions.onMyOrderChanged$,
        credentialAvailability().filter(Boolean).mapTo(null))
        .filter(hasApiCredentials)
        .remember();

    const positions$ = Stream.merge(
        refreshes$.compose(sampleCombine(settledCloseId$)).map(([_, id]) => id),
        // The initial poll already samples the current close ID.
        settledCloseId$.drop(1).filter((id) => id !== undefined).filter(hasApiCredentials),
    ).map((positionCloseId): PositionRequest => ({
        ...getPositions() as AccountRequest, positionCloseId, credentialVersion: currentCredentialVersion()!,
    }));

    return Stream.merge(
        refreshes$.map(() => getOrders()),
        positions$,
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
        .map(() => ({ ...getParentOrders(), credentialVersion: currentCredentialVersion()! }));
};
