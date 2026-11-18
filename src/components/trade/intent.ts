import {RequestOptions} from "@cycle/http";
import {Stream} from "xstream";
import debounce from "xstream/extra/debounce";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {AccountRequest, isCurrentAccountRequest} from "../../drivers/httpDriver";
import {ChildOrderEvent, isExecution} from "../../models/orderEvent";
import {Position} from "../../models/position";
import {Sources} from "./index";
import {ActiveParentOrder, parentOrderDetails} from "./parentOrderDetails";

export interface Actions {
    onCancelParentOrder$: Stream<string>;
    onExecutionCreated$: Stream<object>;
    onMyExecutionCreated$: Stream<ChildOrderEvent>;
    onMyOrderChanged$: Stream<null>;
    onOrdersLoaded$: Stream<object[]>;
    onParentOrderLoaded$: Stream<ActiveParentOrder>;
    onParentOrdersLoaded$: Stream<ActiveParentOrder[]>;
    parentOrderRequests$: Stream<RequestOptions>;
    onPositionsLoaded$: Stream<{ position: Position; positionCredentialVersion: number }>;
}

export const intent = (sources: Sources): Actions => {
    const isCurrent = (response: { request: AccountRequest }) => isCurrentAccountRequest(response.request);

    const onCancelParentOrder$ = sources.HTTP.select("cancel-parent-order")
        .map((response$) => response$.replaceError(() => Stream.empty()))
        .compose(flattenConcurrently)
        .filter(isCurrent)
        .map((response) => JSON.parse(response.request.send as string).parent_order_id);

    const onExecutionCreated$ = sources.socket.execution$;

    const onMyExecutionCreated$ = sources.socket.childOrderEvent$.filter(isExecution);

    const onMyOrderChanged$ = Stream.merge(
        sources.socket.childOrderEvent$.mapTo(null),
        sources.socket.parentOrderEvent$.mapTo(null),
        sources.socket.reconnect$,
    ).compose(debounce(500));

    const onOrdersLoaded$ = sources.HTTP.select("orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .filter(isCurrent)
        .map((response) => JSON.parse(response.text));

    const onParentOrdersLoaded$ = sources.HTTP.select("parent-orders")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .filter(isCurrent)
        .map((response) => JSON.parse(response.text));

    const details = parentOrderDetails(
        sources.HTTP, onParentOrdersLoaded$, sources.socket.parentOrderEvent$, sources.socket.reconnect$,
    );

    const onPositionsLoaded$ = sources.HTTP.select("positions")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .filter(isCurrent)
        .map((response) => ({
            positions: JSON.parse(response.text),
            credentialVersion: (response.request as AccountRequest).credentialVersion,
        }))
        .filter(({ positions }) => Array.isArray(positions))
        .map(({ positions, credentialVersion }) => ({
            position: new Position(positions),
            positionCredentialVersion: credentialVersion!,
        }));

    return {
        onCancelParentOrder$,
        onExecutionCreated$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$,
        onParentOrderLoaded$: details.loaded$,
        onParentOrdersLoaded$,
        onPositionsLoaded$,
        parentOrderRequests$: details.requests$,
    };
};
