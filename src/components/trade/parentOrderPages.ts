import {HTTPSource, RequestOptions, Response} from "@cycle/http";
import Stream from "xstream";
import concat from "xstream/extra/concat";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {getParentOrders, hasApiCredentials, parentOrdersPageSize} from "../../http";
import {ActiveParentOrder} from "./parentOrderDetails";

interface ParentOrderList {
    orders: ActiveParentOrder[];
    sequence: number;
}

interface PageRequest extends RequestOptions {
    parentOrderList?: ParentOrderList;
}

interface PageResult {
    list: ParentOrderList;
    before?: number;
    failed?: boolean;
}

export const parentOrderPages = (http: HTTPSource, nextSequence: () => number) => {
    let latestSequence = 0;
    const firstPages$ = http.select("parent-orders")
        .map((response$) => {
            latestSequence = nextSequence();
            return readPage(response$, { orders: [], sequence: latestSequence });
        })
        .flatten();
    const nextPages$ = http.select("parent-orders-page")
        .map((response$) => {
            const parentOrderList = (response$.request as PageRequest | undefined)?.parentOrderList;
            return parentOrderList?.sequence === latestSequence
                ? readPage(response$, parentOrderList)
                : Stream.empty();
        })
        .compose(flattenConcurrently);

    const pages$ = Stream.merge(firstPages$, nextPages$)
        .filter(({list}) => list.sequence === latestSequence);
    return {
        loaded$: pages$.filter(({before, failed}) => before === undefined && !failed).map(({list}) => list),
        settled$: pages$.filter(({before}) => before === undefined).mapTo(null),
        requests$: pages$
            .filter(({before}) => before !== undefined)
            .map(({before, list}): PageRequest => ({ ...getParentOrders(before), parentOrderList: list })),
    };
};

const readPage = (response$: Stream<Response> & { request?: RequestOptions },
                  previous: ParentOrderList) => concat(
    response$.map((response): PageResult => {
        const page = JSON.parse(response.text) as Array<ActiveParentOrder & { id: number }>;
        if (!Array.isArray(page) || page.some((order) => typeof order?.parent_order_id !== "string")) {
            throw new Error("Invalid active parent order page");
        }
        const before = page.length < parentOrdersPageSize ? undefined : Math.min(...page.map(({id}) => id));
        const cursor = (response$.request?.query as { before?: number } | undefined)?.before;
        if (before !== undefined && (!Number.isSafeInteger(before) || (cursor !== undefined && before >= cursor))) {
            throw new Error("Invalid active parent order cursor");
        }
        if (before !== undefined && !hasApiCredentials()) {
            return { list: previous, failed: true };
        }
        return { before, list: { ...previous, orders: previous.orders.concat(page) } };
    }).replaceError(() => Stream.empty<PageResult>()),
    Stream.of<PageResult>({ list: previous, failed: true }),
).take(1);
