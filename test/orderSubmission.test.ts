import {mockDOMSource, VNode} from "@cycle/dom";
import {RequestOptions, Response, ResponseStream} from "@cycle/http";
import {MainHTTPSource} from "@cycle/http/lib/cjs/MainHTTPSource";
import {StateSource} from "@cycle/state";
import {routerify} from "cyclic-router";
import {deepEqual, doesNotMatch, equal, match} from "node:assert/strict";
import {test, TestContext} from "node:test";
import switchPath from "switch-path";
import Stream, {MemoryStream} from "xstream";
import {Sound} from "../src/drivers/soundDriver";
import {Root, Sinks, Sources} from "../src/components";
import {State as TradeState} from "../src/components/trade";
import {groupSizeStorageKey} from "../src/components/trade/board/intent";
import {storageKeys} from "../src/components/trade/order/intent";
import {BoardLevels} from "../src/models/board";

test("rejects invalid IFDOCO clicks without blocking the next market order", (t) => {
    const order = setup(t, "-10000");

    order.buyIFDOCO();
    order.sellIFDOCO();
    deepEqual(order.requests, []);
    equal(order.state.isOrdering, false);

    order.buyMarket();
    deepEqual(order.requests.map(({ category }) => category), ["market-order"]);
    equal(order.state.isOrdering, true);
});

test("accepts a single IFDOCO submission until its delayed success", (t) => {
    const order = setup(t);

    order.buyIFDOCO();
    order.buyIFDOCO();
    order.sellIFDOCO();
    order.buyMarket();

    deepEqual(order.requests.map(({ category }) => category), ["ifdoco-order"]);
    equal(order.state.isOrdering, true);
    deepEqual(order.sounds, []);

    const response = order.respondTo(order.requests[0]);
    response.progress();
    deepEqual(order.sounds, []);
    deepEqual(order.histories, []);
    response.succeed();
    equal(order.state.isOrdering, false);
    deepEqual(order.sounds, ["success"]);
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
    const sound = outcome === "succeed" ? "success" : "failure";
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

        deepEqual(order.sounds, []);
        response[outcome]();
        deepEqual(order.sounds, [sound]);
        equal(order.state.isOrdering, false);
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), expectedHistories);
        order.sellIFDOCO();
        equal(order.requests.length, 2);
    });

    test(`unlocks IFDOCO when the original request settles in settings (${outcome})`, (t) => {
        const order = setup(t);
        order.buyIFDOCO();

        order.navigate("/setting");
        deepEqual(order.sounds, []);
        order.respondTo(order.requests[0])[outcome]();
        deepEqual(order.sounds, [sound]);
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), expectedHistories);
        order.navigate("/");
        deepEqual(order.sounds, [sound]);
        equal(order.state.isOrdering, false);
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), expectedHistories);
        order.sellIFDOCO();
        equal(order.requests.length, 2);
    });
}

test("records a rejected limit order and permits a retry", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1000 });
    const order = setup(t);
    order.enterPrice("900");

    order.buyLimit();
    deepEqual(order.requests.map(({ category }) => category), ["limit-order"]);
    equal(order.state.isOrdering, true);

    order.respondTo(order.requests[0]).reject();
    equal(order.state.isOrdering, false);
    deepEqual(order.sounds, ["failure"]);
    deepEqual(order.histories, [{
        createdAt: new Date(1000),
        description: "BUY / 0.01 / 900",
        name: "Limit",
        status: "failed",
    }]);

    order.buyLimit();
    deepEqual(order.requests.map(({ category }) => category), ["limit-order", "limit-order"]);
    equal(order.state.isOrdering, true);
});

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

    order.respondTo(order.requests[2]).fail();
    equal(order.state.isOrdering, false);
    deepEqual(order.sounds, []);
    order.clearOrders();
    deepEqual(order.requests.slice(3).map(({ category }) => category), ["cancel-orders", "cancel-parent-order"]);
    equal(JSON.parse(order.requests[4].send as string).parent_order_id, "JCO-failure");
});

test("previews both market sides from synchronized public depth without credentials", async (t) => {
    const order = setup(t, "0.01", false);
    await Promise.resolve();
    equal(order.tradeState.boardComponentState?.groupedSize, 100);
    const boardResponse = order.respondTo(order.boardRequest!);

    order.updateBoard({ asks: [{ price: 110, size: 0.02 }], bids: [] });
    match(order.rendered(), /Order book unavailable/);
    doesNotMatch(order.rendered(), /110 JPY/);

    boardResponse.succeed({
        asks: [{ price: 100, size: 0.01 }],
        bids: [{ price: 90, size: 0.01 }, { price: 72, size: 0.02 }],
    });
    match(order.rendered(), /Live average fill estimates \(before fees\)/);
    match(order.rendered(), /100 JPY \(0.0000%\)/);
    match(order.rendered(), /90 JPY \(0.0000%\)/);

    order.enterSize("0.02");
    match(order.rendered(), /105 JPY \(\+5.0000%\)/);
    match(order.rendered(), /81 JPY \(-10.0000%\)/);

    order.updateBoard({ asks: [{ price: 110, size: 0 }], bids: [] });
    match(order.rendered(), /Insufficient depth/);
    match(order.rendered(), /81 JPY \(-10.0000%\)/);

    order.enterSize("0");
    doesNotMatch(order.rendered(), /market-fill-preview/);
    deepEqual(order.requests, []);
});

function setup(t: TestContext, width = "0.01", credentials = true) {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: credentials ? { "api-secret": "test" } : {} });
    t.after(() => {
        if (originalStorage) {
            Object.defineProperty(globalThis, "localStorage", originalStorage);
        } else {
            Reflect.deleteProperty(globalThis, "localStorage");
        }
    });

    const buyIFDOCO$ = Stream.create<null>();
    const sellIFDOCO$ = Stream.create<null>();
    const buyLimit$ = Stream.create<null>();
    const buyMarket$ = Stream.create<null>();
    const board$ = Stream.create<BoardLevels>();
    const sizeInput$ = Stream.create<{ target: { value: string } }>();
    const priceInput$ = Stream.create<{ target: { value: string } }>();
    const clearOrders$ = Stream.create<null>();
    const responses$ = Stream.create<MemoryStream<Response> & ResponseStream>();
    const state$ = Stream.createWithMemory<{ trade?: TradeState }>();
    const history$ = Stream.createWithMemory<{ pathname: string }>();
    history$.shamefullySendNext({ pathname: "/" });
    const orderEvents = {
        "#size-input": { input: sizeInput$ },
        "#price-input": { input: priceInput$ },
        ".order-buttons": { ".clear-order-button": { click: clearOrders$ } },
        ".limit-order-buttons": { ".buy-button": { click: buyLimit$ } },
        ".market-order-buttons": { ".buy-button": { click: buyMarket$ } },
        ".ranged-ifdoco-order-buttons": {
            ".buy-button": { click: buyIFDOCO$ },
            ".sell-button": { click: sellIFDOCO$ },
        },
    };
    const storedValues: Record<string, string> = { [groupSizeStorageKey]: "100", [storageKeys.priceWidth]: width };
    const main: Sinks = routerify(Root, switchPath)({
        DOM: mockDOMSource({ ".___trade": new Proxy({}, { get: (_, selector) =>
            typeof selector === "string" && selector.startsWith(".___cycle") ? orderEvents : undefined,
        }) }),
        HTTP: new MainHTTPSource(responses$, "HTTP"),
        history: history$,
        socket: {
            connected$: Stream.of(true),
            board$,
            childOrderEvent$: Stream.never(),
            execution$: Stream.never(),
            executionBatch$: Stream.never(),
            parentOrderEvent$: Stream.never(),
            reconnect$: Stream.never(),
        },
        state: new StateSource(state$, "state"),
        storage: { local: { getItem: (key: string) => Stream.of(storedValues[key] ?? "0.01") } },
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
    let boardRequest: RequestOptions | undefined;
    const http = main.HTTP.subscribe({ next: (request) => {
        const options = request as RequestOptions;
        if (options.category === "board") { boardRequest = options; }
        if (["ifdoco-order", "limit-order", "market-order", "cancel-orders", "cancel-parent-order"]
            .includes(options.category as string)) {
            requests.push(options);
        }
    } });
    let vnode: VNode;
    const dom = main.DOM.subscribe({ next: (value) => { vnode = value; } });
    const sounds: Sound[] = [];
    const audio = main.sound!.subscribe({ next: (sound) => sounds.push(sound) });
    t.after(() => {
        dom.unsubscribe();
        audio.unsubscribe();
        http.unsubscribe();
        reducers.unsubscribe();
    });

    return {
        get boardRequest() { return boardRequest; },
        buyIFDOCO: () => buyIFDOCO$.shamefullySendNext(null),
        buyLimit: () => buyLimit$.shamefullySendNext(null),
        buyMarket: () => buyMarket$.shamefullySendNext(null),
        clearOrders: () => clearOrders$.shamefullySendNext(null),
        enterPrice: (value: string) => priceInput$.shamefullySendNext({ target: { value } }),
        enterSize: (value: string) => sizeInput$.shamefullySendNext({ target: { value } }),
        rendered: () => JSON.stringify(vnode),
        updateBoard: (delta: BoardLevels) => board$.shamefullySendNext(delta),
        get histories() { return state!.trade!.histories; },
        navigate: (pathname: string) => history$.shamefullySendNext({ pathname }),
        requests,
        sounds,
        respondTo(request: RequestOptions) {
            const response$ = Object.assign(Stream.createWithMemory<Response>(), { request: { ...request } });
            responses$.shamefullySendNext(response$);
            return {
                fail: () => response$.shamefullySendError(new Error("Network failure")),
                progress: () => response$.shamefullySendNext({ request } as Response),
                reject: () => response$.shamefullySendError({ response: { request, status: 400 } }),
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
