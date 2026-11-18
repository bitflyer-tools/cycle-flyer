import {mockDOMSource, VNode} from "@cycle/dom";
import {RequestOptions, Response, ResponseStream} from "@cycle/http";
import {MainHTTPSource} from "@cycle/http/lib/cjs/MainHTTPSource";
import {StateSource} from "@cycle/state";
import {routerify} from "cyclic-router";
import {deepEqual, equal} from "node:assert/strict";
import {test, TestContext} from "node:test";
import switchPath from "switch-path";
import Stream, {MemoryStream} from "xstream";
import {Root, Sinks, Sources} from "../src/components";
import {State as TradeState} from "../src/components/trade";
import {saveCredentials} from "../src/credentials";
import {authorizeRequest, makeSignedHTTPDriver, unsignedRequests$} from "../src/drivers/httpDriver";

test("shows a signing error for a market order without credentials and clears it on retry", async (t) => {
    const order = setup(t);
    await saveCredentials(null);
    order.buyMarket();
    equal(order.state.isOrdering, true);

    await rejectUnsigned(order.requests[0]);
    equal(order.state.isOrdering, false);
    equal(order.signingAlert?.text, "Could not sign the order. Check your bitFlyer credentials in Settings.");

    order.buyMarket();
    equal(order.requests.length, 2);
    equal(order.signingAlert, undefined);
});

test("shows a clear-orders signing error after returning from Settings", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    order.clearOrders();
    equal(order.requests[0].category, "cancel-orders");
    equal(order.state.isOrdering, true);
    order.navigate("/setting");

    await rejectUnsigned({ ...order.requests[0], send: {} });
    order.navigate("/");
    equal(order.state.isOrdering, false);
    equal(order.signingAlert?.text,
        "Could not sign the request to clear orders. Check your bitFlyer credentials in Settings.");
});

test("accepts a single IFDOCO submission until its delayed success", (t) => {
    const order = setup(t);

    order.buyIFDOCO();
    order.buyIFDOCO();
    order.sellIFDOCO();
    order.buyMarket();

    deepEqual(order.requests.map(({ category }) => category), ["ifdoco-order"]);
    equal(order.state.isOrdering, true);

    order.respondTo(order.requests[0]).succeed();
    equal(order.state.isOrdering, false);
    deepEqual(order.histories.map(({ status }) => status), ["success", "success", "success"]);

    order.sellIFDOCO();
    equal(order.requests.length, 2);
    equal(JSON.parse(order.requests[1].send as string).parameters[0].side, "SELL");
    const sellResponse = order.respondTo(order.requests[1]);
    order.respondTo(order.requests[0]).succeed();
    equal(order.state.isOrdering, true);

    sellResponse.succeed();
    equal(order.state.isOrdering, false);
    equal(order.histories.length, 9);
});

test("releases a failed IFDOCO and keeps a later market order locked through stale responses", (t) => {
    const order = setup(t);

    order.buyIFDOCO();
    order.respondTo(order.requests[0]).fail();
    equal(order.state.isOrdering, false);
    deepEqual(order.histories.map(({ status }) => status), ["failed", "failed", "failed"]);

    order.buyMarket();
    const marketResponse = order.respondTo(order.requests[1]);
    const staleResponse = order.respondTo(order.requests[0]);
    staleResponse.succeed();
    equal(order.histories.length, 6);
    equal(order.state.isOrdering, true);
    order.buyIFDOCO();
    equal(order.requests.length, 2);

    marketResponse.succeed();
    equal(order.state.isOrdering, false);
    equal(order.histories[0].name, "Market");
    order.buyIFDOCO();
    equal(order.requests.length, 3);
});

for (const outcome of ["succeed", "fail"] as const) {
    const status = outcome === "succeed" ? "success" : "failed";
    const expectedHistories = ["Stop", "Limit", "Market"].map((name) => ({ name, status }));

    test(`keeps IFDOCO pending after returning from settings until the original request settles (${outcome})`, (t) => {
        const order = setup(t);
        order.buyIFDOCO();
        const response = order.respondTo(order.requests[0]);

        order.navigate("/setting");
        order.navigate("/");
        equal(order.state.isOrdering, true);
        order.sellIFDOCO();
        equal(order.requests.length, 1);

        response[outcome]();
        equal(order.state.isOrdering, false);
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), expectedHistories);
        order.sellIFDOCO();
        equal(order.requests.length, 2);
    });

    test(`unlocks IFDOCO when the original request settles in settings (${outcome})`, (t) => {
        const order = setup(t);
        order.buyIFDOCO();

        order.navigate("/setting");
        order.respondTo(order.requests[0])[outcome]();
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), expectedHistories);
        order.navigate("/");
        equal(order.state.isOrdering, false);
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), expectedHistories);
        order.sellIFDOCO();
        equal(order.requests.length, 2);
    });
}

test("blocks TWAP with missing credentials and immediately after clearing them", async (t) => {
    const order = setup(t);
    await saveCredentials(null);
    order.buyTWAP();
    equal(order.requests.length, 0);
    equal(order.state.twap.remaining, 0);

    await saveCredentials({ key: "test-key", secret: "test-secret" });
    order.buyTWAP();
    equal(order.requests.length, 1);

    const clearing = saveCredentials(null);
    order.buyTWAP();
    await clearing;
    order.buyTWAP();
    equal(order.requests.length, 1);
    equal(order.state.twap.remaining, 0);
    equal(order.state.twap.error, "TWAP stopped because credentials changed.");
});

test("stops TWAP on signing failure and ignores old slices after a restart", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));

    order.buyTWAP();
    const signed = await authorizeRequest(order.requests[0]) as RequestOptions;
    const previousResponse = order.respondTo(signed);
    t.mock.timers.tick(1000);

    equal(await authorizeRequest({ ...order.requests[1], send: {} }), null);
    equal(order.state.twap.remaining, 0);
    equal(order.state.twap.error, "TWAP stopped because an order could not be signed.");
    t.mock.timers.tick(3000);
    equal(order.requests.length, 2);

    order.buyTWAP();
    equal(order.state.twap.remaining, 3);
    equal(order.state.twap.error, undefined);
    previousResponse.succeed();
    equal(order.state.twap.remaining, 3);
    equal(order.histories[0].name, "TWAP");
});

function rejectUnsigned(request: RequestOptions) {
    return new Promise<void>((resolve, reject) => {
        unsignedRequests$.filter((unsigned) => unsigned === request).take(1).addListener({ next: () => resolve() });
        makeSignedHTTPDriver()(Stream.of(request)).select().addListener({
            next: () => reject(new Error("An unsigned request reached the HTTP driver")),
        });
    });
}

function findSigningAlert(node: VNode): VNode | undefined {
    if (node.sel === "div.order-signing-error") { return node; }
    return node.children?.map((child) => typeof child === "string" ? undefined : findSigningAlert(child)).find(Boolean);
}

function setup(t: TestContext) {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { "api-secret": "test" } });
    t.after(() => {
        if (originalStorage) {
            Object.defineProperty(globalThis, "localStorage", originalStorage);
        } else {
            Reflect.deleteProperty(globalThis, "localStorage");
        }
    });

    const buyIFDOCO$ = Stream.create<null>();
    const sellIFDOCO$ = Stream.create<null>();
    const buyTWAP$ = Stream.create<null>();
    const buyMarket$ = Stream.create<null>();
    const clearOrders$ = Stream.create<null>();
    const responses$ = Stream.create<MemoryStream<Response> & ResponseStream>();
    const state$ = Stream.createWithMemory<{ trade?: TradeState }>();
    const history$ = Stream.createWithMemory<{ pathname: string }>();
    history$.shamefullySendNext({ pathname: "/" });
    const orderEvents = {
        ".twap-order-buttons": { ".buy-button": { click: buyTWAP$ } },
        ".market-order-buttons": { ".buy-button": { click: buyMarket$ } },
        ".order-buttons": { ".clear-order-button": { click: clearOrders$ } },
        ".ranged-ifdoco-order-buttons": {
            ".buy-button": { click: buyIFDOCO$ },
            ".sell-button": { click: sellIFDOCO$ },
        },
    };
    const main: Sinks = routerify(Root, switchPath)({
        DOM: mockDOMSource({ ".___trade": new Proxy({}, { get: (_, selector) =>
            typeof selector === "string" && selector.startsWith(".___cycle") ? orderEvents : undefined,
        }) }),
        HTTP: new MainHTTPSource(responses$, "HTTP"),
        history: history$,
        socket: {
            board$: Stream.never(),
            childOrderEvent$: Stream.never(),
            execution$: Stream.never(),
            parentOrderEvent$: Stream.never(),
        },
        state: new StateSource(state$, "state"),
        storage: { local: { getItem: (key: string) =>
            Stream.of({ "twap-slices": "3", "twap-interval": "1", "order-size": "0.03" }[key] || "0.01"),
        } },
    } as unknown as Omit<Sources, "router"> & { history: typeof history$ });

    let state: { trade?: TradeState } | undefined;
    const reducers = main.state.subscribe({
        next: (reduce) => {
            state = reduce(state);
            if (state) {
                state$.shamefullySendNext(state);
            }
        },
    });
    const requests: RequestOptions[] = [];
    const http = main.HTTP.subscribe({ next: (request) => {
        const options = request as RequestOptions;
        if (["ifdoco-order", "market-order", "twap-order", "cancel-orders"].includes(options.category)) {
            requests.push(options);
        }
    } });
    let vNode: VNode;
    const dom = main.DOM.subscribe({ next: (node) => { vNode = node; } });
    t.after(() => {
        dom.unsubscribe();
        http.unsubscribe();
        reducers.unsubscribe();
    });

    return {
        buyIFDOCO: () => buyIFDOCO$.shamefullySendNext(null),
        buyTWAP: () => buyTWAP$.shamefullySendNext(null),
        buyMarket: () => buyMarket$.shamefullySendNext(null),
        clearOrders: () => clearOrders$.shamefullySendNext(null),
        get histories() { return state!.trade!.histories; },
        navigate: (pathname: string) => history$.shamefullySendNext({ pathname }),
        requests,
        respondTo(request: RequestOptions) {
            const response$ = Object.assign(Stream.createWithMemory<Response>(), { request: { ...request } });
            responses$.shamefullySendNext(response$);
            return {
                fail: () => response$.shamefullySendError(new Error("Network failure")),
                succeed: () => {
                    response$.shamefullySendNext({ request } as Response);
                    response$.shamefullySendComplete();
                },
            };
        },
        sellIFDOCO: () => sellIFDOCO$.shamefullySendNext(null),
        get signingAlert() { return findSigningAlert(vNode); },
        get state() { return state!.trade!.orderComponentState!; },
    };
}
