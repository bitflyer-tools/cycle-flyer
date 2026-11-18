import {RequestOptions, Response} from "@cycle/http";
import {isolateSink} from "@cycle/http/lib/cjs/isolate";
import {deepStrictEqual, strictEqual} from "node:assert";
import {test} from "node:test";
import Stream from "xstream";
import type {State} from "../src/components/trade";
import {intent} from "../src/components/trade/intent";
import {model} from "../src/components/trade/model";
import {ActiveParentOrder} from "../src/components/trade/parentOrderDetails";
import {request} from "../src/components/trade/request";
import {ParentOrderEvent} from "../src/models/orderEvent";
import {flattenStopOrders} from "../src/models/parentStopOrders";

test("reuses 20 loaded details and coalesces duplicate IDs while they are pending", (t) => {
    const trade = setup(t);
    const ids = Array.from({ length: 20 }, (_, index) => `parent-${index}`);
    trade.list([...ids, ids[0]]);
    trade.list(ids);
    deepStrictEqual(trade.requestedIds(), ids);

    [...trade.requests].reverse().forEach((input) => trade.complete(input));
    trade.list(ids);
    deepStrictEqual(trade.requestedIds(), ids);
    strictEqual(trade.loaded.length, 20);
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

[false, true].forEach((reverse) => {
    test(`keeps both stop markers when details resolve ${reverse ? "in reverse order" : "in request order"}`, (t) => {
        const trade = setup(t);
        let state: State | undefined;
        const subscription = model(trade.actions).subscribe({
            next: (reducer) => { state = reducer(state); },
        });
        t.after(() => subscription.unsubscribe());

        trade.list(["a", "b"]);
        deepStrictEqual(state!.parentStopOrders, { a: [], b: [] });
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
    trade.requests.forEach(trade.complete);
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

const setup = (t: { after: (cleanup: () => void) => void }) => {
    const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true, value: { "api-key": "test-key", "api-secret": "test-secret" },
    });
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
        socket: { childOrderEvent$: Stream.never(), execution$: Stream.never(), parentOrderEvent$: events,
            reconnect$: reconnect },
    };
    const actions = intent(sources as unknown as Parameters<typeof intent>[0]);
    const requests: RequestOptions[] = [];
    const listRequests: RequestOptions[] = [];
    const loaded: ActiveParentOrder[] = [];
    const request$ = request(actions).filter((input): input is string | RequestOptions => input !== null);
    const sink = isolateSink(request$, "trade").subscribe({ next: (input) => {
        if (typeof input !== "object") { return; }
        if (input.category === "parent-order") { requests.push(input); }
        if (input.category === "parent-orders") { listRequests.push(input); }
    } });
    const details = actions.onParentOrderLoaded$.subscribe({ next: (detail) => loaded.push(detail) });
    t.after(() => {
        sink.unsubscribe();
        details.unsubscribe();
        if (storage) { Object.defineProperty(globalThis, "localStorage", storage); }
        else { Reflect.deleteProperty(globalThis, "localStorage"); }
    });

    const requestedId = (input: RequestOptions) => (input.query as ActiveParentOrder).parent_order_id;
    const send = (input: RequestOptions, response$: Stream<Response>) => {
        const response = Object.assign(response$, { request: input });
        channels.get(input.category!)!.shamefullySendNext(response);
    };
    const respond = (input: RequestOptions, body: object) =>
        send(input, Stream.of({ text: JSON.stringify(body) } as Response));

    return {
        actions,
        complete: (input: RequestOptions) => respond(input, { parent_order_id: requestedId(input), parameters: [] }),
        events,
        fail: (input: RequestOptions) => send(input, Stream.throw(new Error("Request failed"))),
        list: (ids: string[], withoutAcceptanceId: string[] = []) => respond({ category: "parent-orders", url: "" },
            ids.map((id) => ({
                parent_order_acceptance_id: withoutAcceptanceId.includes(id) ? undefined : `acceptance-${id}`,
                parent_order_id: id,
            }))),
        listRequests,
        loaded,
        reconnect,
        requestedIds: () => requests.map(requestedId),
        requests,
        send,
    };
};
