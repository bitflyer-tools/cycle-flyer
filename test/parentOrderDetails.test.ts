import {RequestOptions, Response} from "@cycle/http";
import {isolateSink} from "@cycle/http/lib/cjs/isolate";
import {deepStrictEqual, strictEqual} from "node:assert";
import {before, test} from "node:test";
import Stream from "xstream";
import type {State} from "../src/components/trade";
import {cancellationReducer} from "../src/components/trade/cancellation";
import {CancellationOutcome} from "../src/components/trade/order/history";
import {intent} from "../src/components/trade/intent";
import {model} from "../src/components/trade/model";
import {ActiveParentOrder} from "../src/components/trade/parentOrderDetails";
import {request} from "../src/components/trade/request";
import {credentialsChanging$, currentCredentialVersion, initializeCredentials, saveCredentials} from "../src/credentials";
import {unsignedRequests$} from "../src/drivers/httpDriver";
import {parentOrdersPageSize} from "../src/http";
import {ParentOrderEvent} from "../src/models/orderEvent";
import {flattenStopOrders} from "../src/models/parentStopOrders";
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

test("flattens stop markers in parent and marker order and caches by record", () => {
    const first = new StopOrder({ price: 300, side: "BUY", size: 1 });
    const second = new StopOrder({ price: 100, side: "SELL", size: 1 });
    const third = new StopOrder({ price: 200, side: "BUY", size: 1 });
    const parentStopOrders = { z: [first, second], pending: [], a: [third] };

    const markers = flattenStopOrders(parentStopOrders);
    deepStrictEqual(markers, [first, second, third]);
    strictEqual(flattenStopOrders(parentStopOrders), markers);
    deepStrictEqual(flattenStopOrders({ ...parentStopOrders, a: [] }), [first, second]);
    strictEqual(flattenStopOrders(parentStopOrders), markers);
});

test("retires a canceled parent only after a fresh list omits it", (t) => {
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    trade.list(["a"]);
    const detail$ = Stream.create<Response>();
    trade.send(trade.requests[0], detail$);
    const oldList$ = trade.startList();
    const latestOldList$ = trade.startList();

    trade.cancel("a");
    latestOldList$.shamefullySendNext({ text: "[]" } as Response);
    deepStrictEqual(Array.from(state().canceledParentOrderIds!.keys()), ["a"]);
    trade.list(["a", "b"]);
    deepStrictEqual(state().parentStopOrders, { b: [] });
    deepStrictEqual(Array.from(state().canceledParentOrderIds!.keys()), ["a"]);

    trade.list(["b"]);
    oldList$.shamefullySendNext({ text: '[{"parent_order_id":"a"}]' } as Response);
    detail$.shamefullySendNext({ text: '{"parent_order_id":"a","parameters":[]}' } as Response);
    deepStrictEqual(state().parentStopOrders, { b: [] });
    strictEqual(state().canceledParentOrderIds?.size, 0);
    deepStrictEqual(trade.loaded, []);
});

test("confirming refreshes retire each of 1,000 distinct cancellation IDs", (t) => {
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    Array.from({ length: 1000 }, (_, index) => `parent-${index}`).forEach((id) => {
        trade.cancel(id);
        deepStrictEqual(Array.from(state().canceledParentOrderIds!.keys()), [id]);
        trade.list([]);
        strictEqual(state().canceledParentOrderIds?.size, 0);
    });
    deepStrictEqual(state().parentStopOrders, {});
});

test("a list started between two cancellations confirms only the earlier cancellation", (t) => {
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    trade.cancel("a");
    const list$ = trade.startList();
    trade.cancel("b");

    list$.shamefullySendNext({ text: "[]" } as Response);
    deepStrictEqual(Array.from(state().canceledParentOrderIds!.keys()), ["b"]);
    trade.list([]);
    strictEqual(state().canceledParentOrderIds?.size, 0);
});

test("reuses 20 loaded details and coalesces duplicate IDs while they are pending", (t) => {
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    const ids = Array.from({ length: 20 }, (_, index) => `parent-${index}`);
    trade.list([...ids, ids[0]]);
    trade.list(ids);
    deepStrictEqual(trade.requestedIds(), ids);

    [...trade.requests].reverse().forEach((input) => trade.complete(input));
    const retained = state().parentStopOrders;
    const markers = flattenStopOrders(retained);
    trade.list(ids);
    strictEqual(state().parentStopOrders, retained);
    strictEqual(flattenStopOrders(state().parentStopOrders), markers);
    trade.list([ids[0], ...[...ids].reverse()]);
    strictEqual(state().parentStopOrders, retained);
    deepStrictEqual(trade.requestedIds(), ids);
    strictEqual(trade.loaded.length, 20);

    const nextIds = [...ids.slice(1), "new-parent"];
    trade.list(nextIds);
    const reconciled = state().parentStopOrders;
    deepStrictEqual(Object.keys(reconciled), nextIds);
    strictEqual(reconciled[ids[1]], retained[ids[1]]);
    deepStrictEqual(reconciled["new-parent"], []);
    deepStrictEqual(trade.requestedIds(), [...ids, "new-parent"]);
});

test("retries only failed and new details after a list refresh", (t) => {
    const trade = setup(t);
    trade.list(["a", "b"]);
    trade.fail(trade.requests[0]);
    trade.complete(trade.requests[1]);
    trade.list(["a", "b", "c"]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "a", "c"]);
    trade.complete(trade.requests[0]);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["b"]);
    trade.complete(trade.requests[2]);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["b", "a"]);
});

test("retries a stalled parent detail on the next poll and ignores its late response", (t) => {
    t.mock.timers.enable({apis: ["setInterval"]});
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    const detail = (trigger_price: number) => ({
        parent_order_id: "a",
        parameters: [{condition_type: "STOP", side: "SELL", size: 0.1, trigger_price}],
    });
    const orders = [{parent_order_id: "a"}];
    trade.respond(trade.listRequests[0], orders);
    const stalled$ = Stream.create<Response>();
    trade.send(trade.requests[0], stalled$);

    t.mock.timers.tick(10000);
    trade.respond(trade.listRequests[1], orders);
    deepStrictEqual(trade.requestedIds(), ["a"]);
    deepStrictEqual(flattenStopOrders(state().parentStopOrders), []);

    t.mock.timers.tick(5000);
    deepStrictEqual(trade.requestedIds(), ["a"]);
    t.mock.timers.tick(5000);
    trade.respond(trade.listRequests[2], orders);
    deepStrictEqual(trade.requestedIds(), ["a", "a"]);
    trade.respond(trade.requests[1], detail(200));
    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [200]);

    stalled$.shamefullySendNext({text: JSON.stringify(detail(100))} as Response);
    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [200]);
    strictEqual(trade.loaded.length, 1);
});

test("ignores stale account responses and resets the detail cache when credentials change", (t) => {
    const trade = setup(t);
    trade.list(["stale"], [], -1);
    deepStrictEqual(trade.requestedIds(), []);

    trade.list(["a", "b"]);
    trade.complete(trade.requests[0]);
    trade.complete(trade.requests[1], -1);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["a"]);

    trade.list(["a", "b"]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "b"]);
    credentialsChanging$.shamefullySendNext(undefined);
    trade.list(["a", "b"]);
    trade.complete(trade.requests[2]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "b", "a", "b"]);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["a"]);
    trade.complete(trade.requests[4]);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["a", "b"]);
});

test("retries a parent detail whose request could not be signed", (t) => {
    const trade = setup(t);
    trade.list(["a"]);
    unsignedRequests$.shamefullySendNext(trade.requests[0]);
    trade.list(["a"]);
    deepStrictEqual(trade.requestedIds(), ["a", "a"]);
    trade.complete(trade.requests[1]);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["a"]);
});

test("preserves a stop marker after malformed details and installs the retried detail", (t) => {
    t.mock.timers.enable({apis: ["setInterval"]});
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    const stop = (trigger_price: number) => ({condition_type: "STOP", side: "SELL", size: 0.1, trigger_price});
    trade.list(["a"]);
    trade.respond(trade.requests[0], {parent_order_id: "a", parameters: [stop(100)]});
    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [100]);

    trade.events.shamefullySendNext({parent_order_id: "a"} as ParentOrderEvent);
    trade.list(["a"]);
    const lastValidState = state();
    trade.respond(trade.requests[1], {parent_order_id: "a", parameters: {}});
    strictEqual(state(), lastValidState);
    strictEqual(trade.loaded.length, 1);

    t.mock.timers.tick(10000);
    strictEqual(trade.listRequests.length, 2);
    trade.respond(trade.listRequests[1], [{parent_order_id: "a"}]);
    deepStrictEqual(trade.requestedIds(), ["a", "a", "a"]);
    trade.respond(trade.requests[2], {parent_order_id: "a", parameters: [stop(200)]});
    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [200]);
});

[false, true].forEach((reverse) => {
    test(`keeps both stop markers when details resolve ${reverse ? "in reverse order" : "in request order"}`, (t) => {
        const trade = setup(t);
        let state: State | undefined;
        const subscription = model(trade.actions).subscribe({
            next: (reducer) => { state = reducer(state); },
        });
        t.after(() => subscription.unsubscribe());

        trade.list(["a", "b"]);
        deepStrictEqual(state!.parentStopOrders, { a: [] as StopOrder[], b: [] as StopOrder[] });
        const resolve = trade.requests.map((input, index) => {
            const response$ = Stream.create<Response>();
            trade.send(input, response$);
            return () => response$.shamefullySendNext({
                text: JSON.stringify({
                    parent_order_id: trade.requestedIds()[index],
                    parameters: [{
                        condition_type: "STOP", side: "SELL", size: 0.1, trigger_price: 100 * (index + 1),
                    }],
                }),
            } as Response);
        });
        (reverse ? resolve.reverse() : resolve).forEach((complete) => complete());

        deepStrictEqual(state!.parentStopOrders.a?.map((order) => order.price), [100]);
        deepStrictEqual(state!.parentStopOrders.b?.map((order) => order.price), [200]);
        const prices = flattenStopOrders(state!.parentStopOrders).map((order) => order.price);
        deepStrictEqual(prices.sort((a, b) => a - b), [100, 200]);
    });
});

test("invalidates the affected parent and discards its pending response", (t) => {
    const trade = setup(t);
    trade.list(["a", "b"]);
    trade.complete(trade.requests[1]);
    trade.events.shamefullySendNext({ parent_order_acceptance_id: "acceptance-a" } as ParentOrderEvent);
    trade.list(["a", "b"]);
    deepStrictEqual(trade.requestedIds(), ["a", "b"]);

    trade.complete(trade.requests[0]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "a"]);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["b"]);

    trade.complete(trade.requests[2]);
    trade.events.shamefullySendNext({ parent_order_id: "a" } as ParentOrderEvent);
    trade.list(["a", "b"]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "a", "a"]);
});

test("uses a late acceptance ID to invalidate only the affected cached detail", (t) => {
    const trade = setup(t);
    trade.list(["a", "b"], ["a"]);
    trade.requests.forEach((input) => trade.complete(input));
    trade.list(["a", "b"]);
    trade.list(["a", "b"], ["a"]);
    deepStrictEqual(trade.requestedIds(), ["a", "b"]);

    trade.events.shamefullySendNext({ parent_order_acceptance_id: "acceptance-a" } as ParentOrderEvent);
    trade.list(["a", "b"]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "a"]);
});

test("reconciles on reconnect and ignores responses for removed parents", async (t) => {
    const trade = setup(t);
    trade.list(["a", "b"]);
    trade.complete(trade.requests[0]);
    const listRequestCount = trade.listRequests.length;
    trade.reconnect.shamefullySendNext(null);
    await new Promise((resolve) => setTimeout(resolve, 550));
    strictEqual(trade.listRequests.length, listRequestCount + 1);

    trade.list(["a"]);
    trade.complete(trade.requests[1]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "a"]);
    deepStrictEqual(trade.loaded.map((detail) => detail.parent_order_id), ["a"]);

    trade.list(["a", "b"]);
    deepStrictEqual(trade.requestedIds(), ["a", "b", "a", "b"]);
});

test("coalesces periodic and order-event refreshes until all parent order pages arrive", (t) => {
    t.mock.timers.enable({apis: ["setInterval"]});
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    const firstPage$ = trade.startList();
    const orders = Array.from({length: 100}, (_, index) => ({
        id: index + 2, parent_order_id: `parent-${index + 2}`,
    }));

    t.mock.timers.tick(10000);
    strictEqual(trade.listRequests.length, 1);
    firstPage$.shamefullySendNext({text: JSON.stringify(orders)} as Response);
    strictEqual(trade.pageRequests.length, 1);

    trade.events.shamefullySendNext({parent_order_id: "parent-1"} as ParentOrderEvent);
    t.mock.timers.tick(10500);
    strictEqual(trade.listRequests.length, 1);
    deepStrictEqual(state().parentStopOrders, {});

    trade.send(trade.pageRequests[0], Stream.of({text: '[{"id":1,"parent_order_id":"parent-1"}]'} as Response));
    deepStrictEqual(Object.keys(state().parentStopOrders), [...orders.map((order) => order.parent_order_id), "parent-1"]);
    strictEqual(trade.listRequests.length, 2);

    trade.startList().shamefullySendNext({text: JSON.stringify(orders)} as Response);
    strictEqual(trade.pageRequests.length, 2);
    trade.events.shamefullySendNext({parent_order_id: "parent-1"} as ParentOrderEvent);
    t.mock.timers.tick(500);
    strictEqual(trade.listRequests.length, 2);
    trade.fail(trade.pageRequests[1]);
    strictEqual(trade.listRequests.length, 3);
    strictEqual(Object.keys(state().parentStopOrders).length, 101);

    trade.fail(trade.listRequests[2]);
    t.mock.timers.tick(10000);
    strictEqual(trade.listRequests.length, 4);
});

test("accumulates several full parent order pages into one ordered list once the poll completes", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    trade.list(["old"]);
    t.mock.timers.tick(10000);

    const page = (highestId: number) => Array.from({ length: parentOrdersPageSize }, (_, index) => ({
        id: highestId - index, parent_order_id: `parent-${highestId - index}`,
    }));
    const firstPage = page(300);
    const secondPage = page(200);
    const finalPage = [{ id: 1, parent_order_id: "parent-1" }];

    trade.respond(trade.listRequests[1], firstPage);
    strictEqual(trade.pageRequests.length, 1);
    deepStrictEqual(Object.keys(state().parentStopOrders), ["old"]);

    trade.respond(trade.pageRequests[0], secondPage);
    strictEqual(trade.pageRequests.length, 2);
    deepStrictEqual(Object.keys(state().parentStopOrders), ["old"]);

    trade.respond(trade.pageRequests[1], finalPage);
    deepStrictEqual(Object.keys(state().parentStopOrders),
        [...firstPage, ...secondPage, ...finalPage].map((order) => order.parent_order_id));
});

[
    { name: "an invalid order", page: [{ id: 1 }] },
    { name: "a repeated cursor", page: Array.from({ length: parentOrdersPageSize }, (_, index) => ({
        id: index + 2, parent_order_id: `repeated-${index}`,
    })) },
].forEach(({ name, page }) => {
    test(`keeps the last complete parent order list when a later page contains ${name}`, (t) => {
        t.mock.timers.enable({ apis: ["setInterval"] });
        const trade = setup(t);
        const state = observeState(t, trade.actions, trade.cancellations$);
        trade.list(["old"]);
        t.mock.timers.tick(10000);
        const firstPage = Array.from({ length: parentOrdersPageSize }, (_, index) => ({
            id: index + 2, parent_order_id: `partial-${index}`,
        }));
        trade.respond(trade.listRequests[1], firstPage);
        strictEqual(trade.pageRequests.length, 1);

        trade.respond(trade.pageRequests[0], page);
        strictEqual(trade.pageRequests.length, 1);
        deepStrictEqual(Object.keys(state().parentStopOrders), ["old"]);

        t.mock.timers.tick(10000);
        strictEqual(trade.listRequests.length, 3);
        trade.respond(trade.listRequests[2], [{ id: 1, parent_order_id: "new" }]);
        deepStrictEqual(Object.keys(state().parentStopOrders), ["new"]);
    });
});

["first", "later"].forEach((stalledPage) => {
    test(`recovers when the ${stalledPage} parent order page times out`, (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const trade = setup(t);
        const state = observeState(t, trade.actions, trade.cancellations$);
        trade.list(["old"]);
        t.mock.timers.tick(10000);
        const firstPage$ = trade.startList();
        const stalled$ = Stream.create<Response>();
        if (stalledPage === "later") {
            const orders = Array.from({length: 100}, (_, index) => ({
                id: index + 2, parent_order_id: `partial-${index}`,
            }));
            firstPage$.shamefullySendNext({text: JSON.stringify(orders)} as Response);
            trade.send(trade.pageRequests[0], stalled$);
        }

        t.mock.timers.tick(14999);
        strictEqual(trade.listRequests.length, 2);
        t.mock.timers.tick(1);
        strictEqual(trade.listRequests.length, 3);
        deepStrictEqual(Object.keys(state().parentStopOrders), ["old"]);

        const late$ = stalledPage === "later" ? stalled$ : firstPage$;
        late$.shamefullySendNext({text: '[{"parent_order_id":"late"}]'} as Response);
        deepStrictEqual(Object.keys(state().parentStopOrders), ["old"]);
        trade.startList().shamefullySendNext({text: '[{"parent_order_id":"new"}]'} as Response);
        deepStrictEqual(Object.keys(state().parentStopOrders), ["new"]);
    });
});

test("does not apply parent order pages from the previous account after credentials change", async (t) => {
    const trade = setup(t);
    const state = observeState(t, trade.actions, trade.cancellations$);
    const firstPage$ = trade.startList();
    const orders = Array.from({length: 100}, (_, index) => ({
        id: index + 2, parent_order_id: `previous-${index}`,
    }));
    firstPage$.shamefullySendNext({text: JSON.stringify(orders)} as Response);
    const oldPage$ = Stream.create<Response>();
    trade.send(trade.pageRequests[0], oldPage$);

    await saveCredentials({ key: "replacement-key", secret: "replacement-secret" });
    strictEqual(trade.listRequests.length, 2);
    oldPage$.shamefullySendNext({text: '[{"id":1,"parent_order_id":"previous-last"}]'} as Response);
    deepStrictEqual(state().parentStopOrders, {});

    const newList$ = Stream.create<Response>();
    trade.send(trade.listRequests[1], newList$, currentCredentialVersion()!);
    newList$.shamefullySendNext({text: '[{"parent_order_id":"current"}]'} as Response);
    deepStrictEqual(Object.keys(state().parentStopOrders), ["current"]);
});

const observeState = (t: { after: (cleanup: () => void) => void }, actions: ReturnType<typeof intent>,
                      cancellations$: Stream<CancellationOutcome>) => {
    let state: State | undefined;
    const subscription = Stream.merge(model(actions), cancellations$.map(cancellationReducer)).subscribe({ next: (reducer) => { state = reducer(state); } });
    t.after(() => subscription.unsubscribe());
    return () => state!;
};

const setup = (t: { after: (cleanup: () => void) => void }) => {
    const cancellations$ = Stream.create<CancellationOutcome>();
    const events = Stream.create<ParentOrderEvent>();
    const reconnect = Stream.create<null>();
    const channels = new Map<string, Stream<Stream<Response>>>();
    const sources = {
        HTTP: {
            select: (category: string) => {
                const channel = Stream.create<Stream<Response>>();
                channels.set(category, channel);
                return channel;
            },
        },
        socket: { childOrderEvent$: Stream.never(), execution$: Stream.never(), executionBatch$: Stream.never(), parentOrderEvent$: events,
            reconnect$: reconnect },
    };
    const actions = intent(sources as unknown as Parameters<typeof intent>[0]);
    const requests: RequestOptions[] = [];
    const listRequests: RequestOptions[] = [];
    const pageRequests: RequestOptions[] = [];
    const loaded: ActiveParentOrder[] = [];
    const request$ = request(actions).filter((input): input is string | RequestOptions => input !== null);
    const sink = isolateSink(request$, "trade").subscribe({ next: (input) => {
        if (typeof input !== "object") { return; }
        if (input.category === "parent-order") { requests.push(input); }
        if (input.category === "parent-orders") { listRequests.push(input); }
        if (input.category === "parent-orders-page") { pageRequests.push(input); }
    } });
    const details = actions.onParentOrderLoaded$.subscribe({ next: (detail) => loaded.push(detail) });
    t.after(() => {
        sink.unsubscribe();
        details.unsubscribe();
    });

    const requestedId = (input: RequestOptions) => new URL(input.url).searchParams.get("parent_order_id")!;
    const send = (input: RequestOptions, response$: Stream<Response>, credentialVersion = 0) => {
        const signedRequest = { ...input, credentialVersion };
        const response = Object.assign(response$.map((value): Response => ({ ...value, request: signedRequest })),
            { request: signedRequest });
        channels.get(input.category!)!.shamefullySendNext(response);
    };
    const respond = (input: RequestOptions, body: object, credentialVersion?: number) =>
        send(input, Stream.of({ text: JSON.stringify(body) } as Response), credentialVersion);

    return {
        actions,
        cancellations$,
        cancel: (parentOrderId: string) =>
            cancellations$.shamefullySendNext({ parentOrderId, status: "success", histories: [] }),
        complete: (input: RequestOptions, credentialVersion?: number) =>
            respond(input, { parent_order_id: requestedId(input), parameters: [] }, credentialVersion),
        events,
        fail: (input: RequestOptions) => send(input, Stream.throw(new Error("Request failed"))),
        list: (ids: string[], withoutAcceptanceId: string[] = [], credentialVersion?: number) => respond({ category: "parent-orders", url: "" },
            ids.map((id) => ({
                parent_order_acceptance_id: withoutAcceptanceId.includes(id) ? undefined : `acceptance-${id}`,
                parent_order_id: id,
            })), credentialVersion),
        listRequests,
        pageRequests,
        loaded,
        reconnect,
        requestedIds: () => requests.map(requestedId),
        requests,
        respond,
        send,
        startList: () => {
            const response$ = Stream.create<Response>();
            send(listRequests[listRequests.length - 1], response$);
            return response$;
        },
    };
};
