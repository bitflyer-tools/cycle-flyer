import {mockDOMSource} from "@cycle/dom";
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

const disconnectedOrders = [
    ["buyMarket", [["Market", "BUY / 0.01 / MARKET"]]],
    ["buyStop", [["Stop", "BUY / 0.01 / 800"]]],
    ["buyIFDOCO", [
        ["Stop", "SELL / 0.01 / -0.01"],
        ["Limit", "SELL / 0.01 / 0"],
        ["Market", "BUY / 0.01 / MARKET"],
    ]],
] as const;

for (const [submit, entries] of disconnectedOrders) {
    test(`${submit} records an unconfirmed order after a disconnect and permits a later submission`, (t) => {
        const order = setup(t);
        order[submit]();
        equal(order.state.isOrdering, true);
        order.respondTo(order.requests[0]).disconnect();
        equal(order.state.isOrdering, false);
        deepEqual(
            order.histories.map(({ name, description, status }) => [name, description, status]),
            entries.map((entry) => [...entry, "unconfirmed"]),
        );

        order[submit]();
        equal(order.requests.length, 2);
        order.respondTo(order.requests[1]).succeed();
        equal(order.state.isOrdering, false);
        deepEqual(order.histories.map(({ status }) => status), [
            ...entries.map(() => "success"),
            ...entries.map(() => "unconfirmed"),
        ]);
    });
}

test("dispatches every Clear Orders request and stays locked until they all settle", (t) => {
    const order = setup(t);
    order.respondTo({ category: "parent-orders", _namespace: ["trade"] }).succeed([
        { parent_order_id: "JCO-success" },
        { parent_order_id: "JCO-failure" },
    ]);

    order.clearOrders();
    order.clearOrders();
    deepEqual(order.requests.map(({ category }) => category), [
        "cancel-orders", "cancel-parent-order", "cancel-parent-order",
    ]);
    equal(order.state.isOrdering, true);

    order.respondTo(order.requests[0]).succeed();
    order.respondTo(order.requests[1]).succeed();
    order.buyMarket();
    equal(order.requests.length, 3);
    equal(order.state.isOrdering, true);
    deepEqual(Object.keys(order.tradeState.parentStopOrders), ["JCO-failure"]);

    order.respondTo(order.requests[2]).disconnect();
    equal(order.state.isOrdering, false);
    order.clearOrders();
    deepEqual(order.requests.slice(3).map(({ category }) => category), ["cancel-orders", "cancel-parent-order"]);
    equal(JSON.parse(order.requests[4].send as string).parent_order_id, "JCO-failure");
});

function setup(t: TestContext) {
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
    const buyMarket$ = Stream.create<null>();
    const buyStop$ = Stream.create<null>();
    const clearOrders$ = Stream.create<null>();
    const responses$ = Stream.create<MemoryStream<Response> & ResponseStream>();
    const state$ = Stream.createWithMemory<{ trade?: TradeState }>();
    const history$ = Stream.createWithMemory<{ pathname: string }>();
    history$.shamefullySendNext({ pathname: "/" });
    const orderEvents = {
        "#trigger-price-input": { input: Stream.of({ target: { value: "800" } }) },
        ".stop-order-buttons": { ".buy-button": { click: buyStop$ } },
        ".order-buttons": { ".clear-order-button": { click: clearOrders$ } },
        ".market-order-buttons": { ".buy-button": { click: buyMarket$ } },
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
            reconnect$: Stream.never(),
        },
        state: new StateSource(state$, "state"),
        storage: { local: { getItem: () => Stream.of("0.01") } },
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
        if (["ifdoco-order", "market-order", "stop-order", "cancel-orders", "cancel-parent-order"].includes(options.category as string)) {
            requests.push(options);
        }
    } });
    t.after(() => {
        http.unsubscribe();
        reducers.unsubscribe();
    });

    return {
        buyIFDOCO: () => buyIFDOCO$.shamefullySendNext(null),
        buyMarket: () => buyMarket$.shamefullySendNext(null),
        buyStop: () => buyStop$.shamefullySendNext(null),
        clearOrders: () => clearOrders$.shamefullySendNext(null),
        get histories() { return state!.trade!.histories; },
        navigate: (pathname: string) => history$.shamefullySendNext({ pathname }),
        requests,
        respondTo(request: RequestOptions) {
            const response$ = Object.assign(Stream.createWithMemory<Response>(), { request: { ...request } });
            responses$.shamefullySendNext(response$);
            return {
                disconnect: () => response$.shamefullySendError(new Error("Disconnected")),
                fail: () => response$.shamefullySendError(Object.assign(new Error("Rejected"), {
                    response: { status: 400 },
                })),
                succeed: (body?: unknown) => {
                    response$.shamefullySendNext({ request, text: JSON.stringify(body) } as Response);
                    response$.shamefullySendComplete();
                },
            };
        },
        sellIFDOCO: () => sellIFDOCO$.shamefullySendNext(null),
        get state() { return state!.trade!.orderComponentState!; },
        get tradeState() { return state!.trade!; },
    };
}
