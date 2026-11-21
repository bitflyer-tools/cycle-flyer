import {RequestOptions} from "@cycle/http";
import {deepStrictEqual, strictEqual} from "node:assert/strict";
import {before, test} from "node:test";
import Stream from "xstream";
import {State as TradeState} from "../src/components/trade";
import {cancellationReducer} from "../src/components/trade/cancellation";
import {intent as tradeIntent} from "../src/components/trade/intent";
import {model as tradeModel} from "../src/components/trade/model";
import {request as tradeRequest} from "../src/components/trade/request";
import {State} from "../src/components/trade/order";
import {cancellationOutcomes} from "../src/components/trade/order/history";
import {intent} from "../src/components/trade/order/intent";
import {model} from "../src/components/trade/order/model";
import {orderRequests} from "../src/components/trade/order/request";
import {currentCredentialVersion, initializeCredentials, saveCredentials} from "../src/credentials";
import {flattenStopOrders, retainActive} from "../src/models/parentStopOrders";
import {StopOrder} from "../src/models/stopOrder";

before(async () => {
    const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: () => "test-credential", removeItem() {} },
    });
    try {
        await initializeCredentials();
    } finally {
        if (storage) { Object.defineProperty(globalThis, "localStorage", storage); }
        else { Reflect.deleteProperty(globalThis, "localStorage"); }
    }
});

test("Clear Orders cancels a standalone stop by parent order ID", () => {
    const {requests} = clearOrders(["JCO-stop"]);

    deepStrictEqual(requests.map(({url}) => new URL(url).pathname), [
        "/v1/me/cancelallchildorders",
        "/v1/me/cancelparentorder",
    ]);
    strictEqual(requests[1].method, "POST");
    deepStrictEqual(JSON.parse(requests[1].send), {
        parent_order_id: "JCO-stop",
        product_code: "FX_BTC_JPY",
    });
});

test("Clear Orders cancels every active parent order across two pages", () => {
    const {click, lists, pages, pageRequests, parentResponses, requests, state} = clearOrders(["JCO-old"], false, false);
    const orders = Array.from({ length: 101 }, (_, index) => ({
        id: 101 - index,
        parent_order_id: `JCO-${101 - index}`,
        parent_order_state: "ACTIVE",
        parent_order_type: "STOP",
    }));
    const firstPage = () => lists.shamefullySendNext(listResponse(orders.slice(0, 100)));

    firstPage();
    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-old"]);
    deepStrictEqual(Object.fromEntries(new URL(pageRequests[0].url).searchParams), {
        product_code: "FX_BTC_JPY", parent_order_state: "ACTIVE", count: "100", before: "2",
    });
    pages.shamefullySendNext(Object.assign(Stream.throw(new Error("Page failed")), { request: pageRequests[0] }));
    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-old"]);

    firstPage();
    const lastPage = { text: JSON.stringify(orders.slice(100)) };
    const respond = (request: RequestOptions) =>
        pages.shamefullySendNext(Object.assign(Stream.of<unknown>(lastPage), { request }));
    respond(pageRequests[0]);
    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-old"]);
    respond(pageRequests[1]);
    strictEqual(pageRequests.length, 2);

    click();
    const parentRequests = requests.filter(({url}) => new URL(url).pathname === "/v1/me/cancelparentorder");
    deepStrictEqual(parentRequests.map(({send}) => JSON.parse(send).parent_order_id),
        orders.map(({parent_order_id}) => parent_order_id));
    parentRequests.forEach((request) => parentResponses.shamefullySendNext(cancellationResponse(request)));
    deepStrictEqual(Object.keys(state().parentStopOrders), []);
});

test("A standalone stop stays visible until its parent cancellation succeeds", () => {
    const {childResponses, parentResponses, requests, state} = clearOrders(["JCO-stop"]);

    childResponses.shamefullySendNext(cancellationResponse({}));
    strictEqual(flattenStopOrders(state().parentStopOrders).length, 1);

    parentResponses.shamefullySendNext(cancellationResponse(requests[1]));
    deepStrictEqual(flattenStopOrders(state().parentStopOrders), []);
    deepStrictEqual(Object.keys(state().parentStopOrders), []);
});

test("Concurrent parent cancellations leave failed orders visible", () => {
    const {parentResponses, requests, state} = clearOrders(["JCO-success", "JCO-failure", "JCO-pending-detail"], true);
    const success$ = Object.assign(Stream.create<unknown>(), { request: { ...requests[1], credentialVersion: currentCredentialVersion()! } });
    const failure$ = Object.assign(Stream.create<unknown>(), { request: { ...requests[2], credentialVersion: currentCredentialVersion()! } });

    parentResponses.shamefullySendNext(success$);
    parentResponses.shamefullySendNext(failure$);
    failure$.shamefullySendError(new Error("Cancellation failed"));
    success$.shamefullySendNext({ request: success$.request });
    success$.shamefullySendComplete();

    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [200]);
    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-failure", "JCO-pending-detail"]);
    strictEqual(JSON.parse(requests[3].send).parent_order_id, "JCO-pending-detail");
});

test("A late parent detail response cannot restore a canceled stop", () => {
    const {sendParentDetail, parentResponses, requests, state} = clearOrders(["JCO-canceled"]);
    parentResponses.shamefullySendNext(cancellationResponse(requests[1]));
    const canceledState = state();

    sendParentDetail("JCO-canceled", 100);

    strictEqual(state(), canceledState);
});

test("A late active list and its details cannot restore a canceled stop", () => {
    const {sendParentDetail, lists, parentResponses, requests, state} = clearOrders(["JCO-canceled", "JCO-active"]);
    const pendingList$ = Object.assign(Stream.create<unknown>(), { request: { credentialVersion: currentCredentialVersion()! } });
    lists.shamefullySendNext(pendingList$);
    parentResponses.shamefullySendNext(cancellationResponse(requests[1]));

    pendingList$.shamefullySendNext({ request: { credentialVersion: currentCredentialVersion()! }, text: JSON.stringify([
        { parent_order_id: "JCO-canceled" },
        { parent_order_id: "JCO-active" },
        { parent_order_id: "JCO-new" },
    ]) });
    sendParentDetail("JCO-canceled", 100);
    sendParentDetail("JCO-new", 300);

    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-active", "JCO-new"]);
    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [200, 300]);
});

test("Clear Orders discards an in-flight child-order poll and requests a fresh list", () => {
    const {childResponses, orderLists, startPolling, state} = clearOrders([]);
    const {polls, subscription} = startPolling();
    const stalePoll$ = Stream.create<unknown>();
    const freshPoll$ = Stream.create<unknown>();

    try {
        orderLists.shamefullySendNext(Stream.of<unknown>(childOrderList(100)));
        orderLists.shamefullySendNext(stalePoll$);
        deepStrictEqual(state().orders.map(({price}) => price), [100]);
        strictEqual(polls.length, 1);

        childResponses.shamefullySendNext(cancellationResponse({}));
        deepStrictEqual(state().orders, []);
        strictEqual(polls.length, 2);

        stalePoll$.shamefullySendNext(childOrderList(100));
        deepStrictEqual(state().orders, []);

        orderLists.shamefullySendNext(freshPoll$);
        freshPoll$.shamefullySendNext(childOrderList(200));
        deepStrictEqual(state().orders.map(({price}) => price), [200]);
    } finally {
        subscription.unsubscribe();
    }
});

test("Clear Orders invalidates every pending child-order poll and accepts the next valid list", () => {
    const {childResponses, orderLists, state} = clearOrders([]);
    const stalePolls = [Stream.create<unknown>(), Stream.create<unknown>()];
    orderLists.shamefullySendNext(Stream.of<unknown>(childOrderList(100)));
    stalePolls.forEach((poll$) => orderLists.shamefullySendNext(poll$));

    childResponses.shamefullySendNext(cancellationResponse({}));
    orderLists.shamefullySendNext(Stream.of<unknown>({ ...childOrderList(0), text: "{}" }));
    stalePolls.forEach((poll$) => poll$.shamefullySendNext(childOrderList(100)));
    deepStrictEqual(state().orders, []);

    const freshPoll$ = Stream.create<unknown>();
    orderLists.shamefullySendNext(freshPoll$);
    orderLists.shamefullySendNext(Stream.of<unknown>({ ...childOrderList(0), text: "invalid JSON" }));
    freshPoll$.shamefullySendNext(childOrderList(200));
    deepStrictEqual(state().orders.map(({price}) => price), [200]);
});

test("A child-order cancellation from previous credentials leaves the current poll active", async (t) => {
    const {childResponses, orderLists, state} = clearOrders([]);
    const request = { credentialVersion: currentCredentialVersion()! };
    const cancellation$ = Object.assign(Stream.create<unknown>(), { request });
    childResponses.shamefullySendNext(cancellation$);

    await saveCredentials({ key: "updated-key", secret: "test-secret" });
    t.after(() => saveCredentials({ key: "test-credential", secret: "test-credential" }));
    orderLists.shamefullySendNext(Stream.of<unknown>(childOrderList(100)));
    const currentPoll$ = Stream.create<unknown>();
    orderLists.shamefullySendNext(currentPoll$);
    cancellation$.shamefullySendNext({ request });
    cancellation$.shamefullySendComplete();

    deepStrictEqual(state().orders.map(({price}) => price), [100]);
    currentPoll$.shamefullySendNext(childOrderList(200));
    deepStrictEqual(state().orders.map(({price}) => price), [200]);
});

test("A failed child-order cancellation leaves the in-flight poll active", () => {
    const {childResponses, orderLists, startPolling, state} = clearOrders([]);
    const {polls, subscription} = startPolling();
    const pendingPoll$ = Stream.create<unknown>();
    const cancellation$ = Object.assign(Stream.create<unknown>(), { request: { credentialVersion: currentCredentialVersion()! } });

    try {
        orderLists.shamefullySendNext(Stream.of<unknown>(childOrderList(100)));
        orderLists.shamefullySendNext(pendingPoll$);
        childResponses.shamefullySendNext(cancellation$);
        cancellation$.shamefullySendError(new Error("Cancellation failed"));
        deepStrictEqual(state().orders.map(({price}) => price), [100]);
        strictEqual(polls.length, 1);

        pendingPoll$.shamefullySendNext(childOrderList(200));
        deepStrictEqual(state().orders.map(({price}) => price), [200]);
    } finally {
        subscription.unsubscribe();
    }
});

function cancellationResponse(input: { category?: string; send?: string }) {
    const request = { ...input, credentialVersion: currentCredentialVersion()! };
    return Object.assign(Stream.of<unknown>({ request }), { request });
}

function listResponse(orders: object[]) {
    const request = { credentialVersion: currentCredentialVersion()! };
    return Object.assign(Stream.of({ request, text: JSON.stringify(orders) }), { request });
}

function childOrderList(price: number) {
    return {
        request: { credentialVersion: currentCredentialVersion()! },
        text: JSON.stringify([{ price, side: "BUY", outstanding_size: 1 }]),
    };
}

function clearOrders(ids: string[], lastDetailPending = false, clickOnSetup = true) {
    const clicks$ = Stream.create();
    const childResponses = Stream.create<Stream<unknown>>();
    const parentResponses = Stream.create<Stream<unknown>>();
    const details = Stream.create<Stream<unknown>>();
    const orderLists = Stream.create<Stream<unknown>>();
    const lists = Stream.create<Stream<unknown>>();
    const pages = Stream.create<Stream<unknown>>();
    const sources = {
        DOM: {
            select(selector: string) {
                return selector === ".clear-order-button" ? { events: () => clicks$ } : this;
            },
            events: () => Stream.never(),
        },
        HTTP: {
            select(category: string) {
                return {
                    "cancel-orders": childResponses,
                    "cancel-parent-order": parentResponses,
                    "parent-order": details,
                    "parent-orders": lists,
                    "parent-orders-page": pages,
                    orders: orderLists,
                }[category] || Stream.never();
            },
        },
        socket: {
            childOrderEvent$: Stream.never(),
            execution$: Stream.never(),
            executionBatch$: Stream.never(),
            parentOrderEvent$: Stream.never(),
            reconnect$: Stream.never(),
        },
        storage: { local: { getItem: () => Stream.never() } },
    } as unknown as Parameters<typeof intent>[0];
    const state$ = Stream.createWithMemory<State>();
    const actions = intent(sources, state$);
    let currentState: State & TradeState;
    model(actions, Stream.of(false)).addListener({
        next: (reducer) => {
            currentState = reducer(currentState)! as State & TradeState;
            state$.shamefullySendNext(currentState);
        },
    });

    const outcome$ = cancellationOutcomes(sources.HTTP);
    outcome$.map(cancellationReducer).addListener({
        next: (reducer) => {
            currentState = reducer(currentState)! as State & TradeState;
            state$.shamefullySendNext(currentState);
        },
    });
    const tradeActions = tradeIntent(sources, outcome$);
    tradeModel(tradeActions).addListener({
        next: (reducer) => {
            currentState = reducer(currentState)! as State & TradeState;
            state$.shamefullySendNext(currentState);
        },
    });

    const stopOrders = ids.slice(0, lastDetailPending ? -1 : ids.length)
        .map((_, index) => new StopOrder({ trigger_price: (index + 1) * 100 }));
    const loadedStops = Object.fromEntries(stopOrders.map((order, index) => [ids[index], [order]]));
    const parentStopOrders = retainActive(loadedStops, ids.map((id) => ({ parent_order_id: id })));
    currentState = { ...currentState!, parentStopOrders };
    state$.shamefullySendNext(currentState);

    const detailRequests = new Map<string, RequestOptions>();
    const pageRequests: RequestOptions[] = [];
    tradeActions.parentOrderRequests$.addListener({
        next: (request) => {
            if (request.category === "parent-orders-page") {
                pageRequests.push(request);
                return;
            }
            const id = new URL(request.url).searchParams.get("parent_order_id")!;
            detailRequests.set(id, request);
        },
    });
    lists.shamefullySendNext(listResponse(ids.map((id) => ({ parent_order_id: id }))));

    const sendParentDetail = (id: string, price: number) => {
        const request = detailRequests.get(id);
        strictEqual(detailRequests.has(id), true);
        const response$ = Stream.of<unknown>({ text: JSON.stringify({
            parameters: [{ condition_type: "STOP", trigger_price: price }],
            parent_order_id: id,
        }) });
        details.shamefullySendNext(Object.assign(response$, { request: { ...request, credentialVersion: currentCredentialVersion()! } }));
    };

    const requests: Array<{ url: string; method: string; send: string; category: string }> = [];
    orderRequests(actions, state$).addListener({ next: (batch) => requests.push(...batch.requests as typeof requests) });
    const click = () => clicks$.shamefullySendNext(null);
    if (clickOnSetup) { click(); }

    const startPolling = () => {
        const polls: RequestOptions[] = [];
        const subscription = tradeRequest(tradeActions).subscribe({
            next: (request) => {
                if (request && typeof request !== "string" && request.category === "orders") polls.push(request);
            },
        });
        return { polls, subscription };
    };
    return {
        childResponses, click, lists, orderLists, pageRequests, pages, parentResponses, requests, sendParentDetail,
        startPolling, state: () => currentState,
    };
}
