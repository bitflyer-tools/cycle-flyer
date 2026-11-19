import {RequestOptions} from "@cycle/http";
import {Stream} from "xstream";
import debounce from "xstream/extra/debounce";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {AccountRequest, isCurrentAccountRequest} from "../../drivers/httpDriver";
import {Execution} from "../../models/execution";
import {ChildOrderEvent, isExecution} from "../../models/orderEvent";
import {Position} from "../../models/position";
import {Sources} from "./index";
import {ActiveParentOrder, parentOrderDetails} from "./parentOrderDetails";
import {pollResponse} from "./pollResponse";

export interface Actions {
    onCancelParentOrder$: Stream<string>;
    onExecutionBatch$: Stream<Execution[]>;
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

    const onPositionsLoaded$ = pollResponse(sources.HTTP.select("positions"), (json, response) =>
        isCurrent(response) && isPositionList(json) ? {
            position: new Position(json),
            positionCredentialVersion: (response.request as AccountRequest).credentialVersion!,
        } : undefined);

    return {
        onCancelParentOrder$,
        onExecutionBatch$: sources.socket.executionBatch$,
        onMyExecutionCreated$,
        onMyOrderChanged$,
        onOrdersLoaded$,
        onParentOrderLoaded$: details.loaded$,
        onParentOrdersLoaded$,
        onPositionsLoaded$,
        parentOrderRequests$: details.requests$,
    };
};

const isPositionList = (positions: unknown): boolean =>
    Array.isArray(positions) && positions.every((position) =>
        (position?.side === "BUY" || position?.side === "SELL")
        && Number.isFinite(position.price) && Number.isFinite(position.size) && position.size > 0);
