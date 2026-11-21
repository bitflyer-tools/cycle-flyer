import {HTTPSource, RequestOptions} from "@cycle/http";
import Stream from "xstream";
import concat from "xstream/extra/concat";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {credentialsChanging$, currentCredentialVersion, hasApiCredentials} from "../../credentials";
import {AccountRequest, isCurrentAccountRequest, unsignedRequests$} from "../../drivers/httpDriver";
import {getParentOrder} from "../../http";
import {ParentOrderEvent} from "../../models/orderEvent";

export interface ActiveParentOrder {
    parent_order_id: string;
    parent_order_acceptance_id?: string;
}

interface ActiveDetail {
    acceptanceId?: string;
    loaded: boolean;
}

interface PendingDetail {
    entry: ActiveDetail;
    requestId: symbol;
}

type DetailRequest = AccountRequest & { parentOrderDetailRequestId?: symbol };

interface DetailUpdate {
    requests?: RequestOptions[];
    detail?: ActiveParentOrder;
}

const detailTimeoutMs = 15000;
const detailExpired = Symbol();
type DetailResult = ActiveParentOrder | typeof detailExpired | undefined;

export const parentOrderDetails = (
    http: HTTPSource,
    activeOrders$: Stream<ActiveParentOrder[]>,
    events$: Stream<ParentOrderEvent>,
    reconnect$: Stream<null>,
) => {
    const active = new Map<string, ActiveDetail>();
    const pending = new Map<string, PendingDetail>();

    const load = (id: string, entry: ActiveDetail): RequestOptions[] => {
        if (entry.loaded || pending.has(id) || !hasApiCredentials()) { return []; }
        const credentialVersion = currentCredentialVersion();
        if (credentialVersion === null) { return []; }
        const requestId = Symbol();
        const request: DetailRequest = {
            ...getParentOrder(id), lazy: true, credentialVersion, parentOrderDetailRequestId: requestId,
        };
        pending.set(id, { entry, requestId });
        return [request];
    };

    const reconcile = (orders: ActiveParentOrder[]): DetailUpdate => {
        const ids = new Set(orders.map((order) => order.parent_order_id));
        active.forEach((_, id) => { if (!ids.has(id)) { active.delete(id); } });
        const requests = orders.reduce((batch: RequestOptions[], order) => {
            const id = order.parent_order_id;
            const entry = active.get(id) || { loaded: false };
            entry.acceptanceId = order.parent_order_acceptance_id ?? entry.acceptanceId;
            active.set(id, entry);
            return batch.concat(load(id, entry));
        }, []);
        return { requests };
    };

    const invalidate = (event: ParentOrderEvent): DetailUpdate => {
        active.forEach((entry, id) => {
            if (id === event.parent_order_id ||
                (event.parent_order_acceptance_id && entry.acceptanceId === event.parent_order_acceptance_id)) {
                active.delete(id);
            }
        });
        return {};
    };

    const settle = (request: DetailRequest, detail?: DetailResult): DetailUpdate => {
        const id = new URL(request.url).searchParams.get("parent_order_id");
        if (!id) { return {}; }
        const previous = pending.get(id);
        if (!previous || previous.requestId !== request.parentOrderDetailRequestId) { return {}; }
        pending.delete(id);
        if (detail === detailExpired || !isCurrentAccountRequest(request)) { return {}; }
        const entry = active.get(id);
        if (!entry) { return {}; }
        if (entry !== previous.entry) { return { requests: load(id, entry) }; }
        if (!detail || detail.parent_order_id !== id) { return {}; }
        entry.loaded = true;
        return { detail };
    };

    const responses$ = http.select("parent-order")
        .map((response$) => Stream.merge(
            Stream.periodic(detailTimeoutMs).mapTo<DetailResult>(detailExpired),
            concat(
                response$.map<DetailResult>((response) => decodeDetail(response.text))
                    .replaceError(() => Stream.empty<DetailResult>()),
                Stream.of<DetailResult>(undefined),
            ),
        ).take(1).map((detail) => settle(response$.request, detail)))
        .compose(flattenConcurrently);

    const updates$ = Stream.merge<DetailUpdate>(
        activeOrders$.map(reconcile),
        events$.map(invalidate),
        reconnect$.map(() => { active.clear(); return {}; }),
        credentialsChanging$.map(() => {
            active.clear();
            pending.clear();
            return {};
        }),
        unsignedRequests$
            .filter((request): request is DetailRequest =>
                typeof request === "object" && (request as DetailRequest).parentOrderDetailRequestId !== undefined)
            .map((request) => settle(request)),
        responses$,
    );
    return {
        loaded$: updates$.map(({ detail }) => Stream.fromArray(detail ? [detail] : [])).flatten(),
        requests$: updates$.map(({ requests }) => Stream.fromArray(requests || [])).flatten(),
    };
};

const decodeDetail = (text: string): ActiveParentOrder | undefined => {
    const detail = JSON.parse(text);
    return Array.isArray(detail?.parameters) && detail.parameters.every((parameter: unknown) =>
        parameter !== null && typeof parameter === "object" && !Array.isArray(parameter)) ? detail : undefined;
};
