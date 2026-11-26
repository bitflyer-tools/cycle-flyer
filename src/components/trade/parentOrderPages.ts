import {HTTPSource, RequestOptions, Response} from "@cycle/http";
import Stream from "xstream";
import concat from "xstream/extra/concat";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {credentialsChanging$} from "../../credentials";
import {AccountRequest, isCurrentAccountRequest, unsignedRequests$} from "../../drivers/httpDriver";
import {getParentOrders, parentOrdersPageSize} from "../../http";
import {ActiveParentOrder} from "./parentOrderDetails";

const pageTimeoutMs = 15000;

interface ParentOrderList {
    sequence: number;
    credentialVersion: number;
}

interface PageRequest extends AccountRequest {
    parentOrderList?: ParentOrderList;
}

interface PageResult {
    list: ParentOrderList;
    before?: number;
    failed?: boolean;
}

export const parentOrderPages = (http: HTTPSource, nextSequence: () => number) => {
    let latestSequence = 0;
    // One accumulator per poll: pages are pushed in arrival order and flattened only once, when the poll completes.
    const pagesBySequence = new Map<number, ActiveParentOrder[][]>();

    const firstPages$ = http.select("parent-orders")
        .filter((response$) => isCurrentAccountRequest(response$.request as AccountRequest))
        .map((response$) => {
            pagesBySequence.clear();
            latestSequence = nextSequence();
            pagesBySequence.set(latestSequence, []);
            return readPage(response$, { sequence: latestSequence,
                credentialVersion: (response$.request as AccountRequest).credentialVersion! }, pagesBySequence);
        })
        .flatten();
    const nextPages$ = http.select("parent-orders-page")
        .map((response$) => {
            const parentOrderList = (response$.request as PageRequest | undefined)?.parentOrderList;
            return isCurrentAccountRequest(response$.request as AccountRequest) && parentOrderList?.sequence === latestSequence
                ? readPage(response$, parentOrderList, pagesBySequence)
                : Stream.empty();
        })
        .compose(flattenConcurrently);

    const pages$ = Stream.merge(firstPages$, nextPages$)
        .filter(({list}) => list.sequence === latestSequence && isCurrentAccountRequest(list));
    const unsignedPages$ = unsignedRequests$
        .filter((request) => typeof request !== "string" && isCurrentAccountRequest(request as AccountRequest)
            && (request.category === "parent-orders" || (request.category === "parent-orders-page"
                && (request as PageRequest).parentOrderList?.sequence === latestSequence)));
    return {
        loaded$: pages$.filter(({before, failed}) => before === undefined && !failed)
            .map(({list}) => {
                const pages = pagesBySequence.get(list.sequence) ?? [];
                pagesBySequence.delete(list.sequence);
                return { orders: ([] as ActiveParentOrder[]).concat(...pages), sequence: list.sequence };
            }),
        settled$: Stream.merge(pages$.filter(({before}) => before === undefined), unsignedPages$,
            credentialsChanging$).mapTo(null),
        requests$: pages$
            .filter(({before}) => before !== undefined)
            .map(({before, list}): PageRequest => ({
                ...getParentOrders(before), credentialVersion: list.credentialVersion, parentOrderList: list,
            })),
    };
};

const readPage = (response$: Stream<Response> & { request?: RequestOptions }, previous: ParentOrderList,
                  pagesBySequence: Map<number, ActiveParentOrder[][]>) => {
    const failure: PageResult = { list: previous, failed: true };
    return Stream.merge(
        Stream.periodic(pageTimeoutMs).mapTo(failure),
        concat(parsePage(response$, previous, pagesBySequence).replaceError(() => Stream.empty<PageResult>()),
            Stream.of(failure)),
    ).take(1);
};

const parsePage = (response$: Stream<Response> & { request?: RequestOptions }, previous: ParentOrderList,
                   pagesBySequence: Map<number, ActiveParentOrder[][]>) =>
    response$.map((response): PageResult => {
        const page = JSON.parse(response.text) as Array<ActiveParentOrder & { id: number }>;
        if (!Array.isArray(page) || page.some((order) => typeof order?.parent_order_id !== "string")) {
            throw new Error("Invalid active parent order page");
        }
        const before = page.length < parentOrdersPageSize ? undefined : Math.min(...page.map(({id}) => id));
        const cursor = response$.request?.url ? new URL(response$.request.url).searchParams.get("before") : null;
        if (before !== undefined && (!Number.isSafeInteger(before) || (cursor !== null && before >= Number(cursor)))) {
            throw new Error("Invalid active parent order cursor");
        }
        pagesBySequence.get(previous.sequence)?.push(page);
        return { before, list: previous };
    });
