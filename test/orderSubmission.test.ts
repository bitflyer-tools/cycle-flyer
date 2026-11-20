import {mockDOMSource} from "@cycle/dom";
import {RequestInput, RequestOptions, Response, ResponseStream} from "@cycle/http";
import {MainHTTPSource} from "@cycle/http/lib/cjs/MainHTTPSource";
import {StateSource} from "@cycle/state";
import {routerify} from "cyclic-router";
import {deepEqual, equal, match} from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import {test, TestContext} from "node:test";
import {setImmediate as flush} from "node:timers/promises";
import switchPath from "switch-path";
import Stream, {MemoryStream} from "xstream";
import {makeHTTPDriver} from "../src/drivers/httpDriver";
import {Sound} from "../src/drivers/soundDriver";
import {Root, Sinks, Sources} from "../src/components";
import {State as TradeState} from "../src/components/trade";
import {storageKeys} from "../src/components/trade/order/intent";
import {Execution} from "../src/models/execution";
import type {State as SummaryState} from "../src/components/trade/summary";
import {view as summaryView} from "../src/components/trade/summary/view";
import {twapSliceOrder} from "../src/http";

test("blocks both IFDOCO sides until the first public execution arrives", (t) => {
    const order = setup(t, "10000", { initialPrice: null });
    order.buy("ifdoco");
    order.sellIFDOCO();
    deepEqual(order.requests, []);
    equal(order.state.isOrdering, false);

    order.publishExecution(10000000);
    order.buy("ifdoco");
    equal(order.requests[0]?.category, "ifdoco-order");
    order.respondTo(order.requests[0]).succeed();
    order.sellIFDOCO();
    deepEqual(order.requests.map(({ category }) => category), ["ifdoco-order", "ifdoco-order"]);
});

test("rejects invalid IFDOCO clicks without blocking the next market order", (t) => {
    const order = setup(t, "-10000");

    order.buy("ifdoco");
    order.sellIFDOCO();
    deepEqual(order.requests, []);
    equal(order.state.isOrdering, false);

    order.buy("market");
    deepEqual(order.requests.map(({ category }) => category), ["market-order"]);
    equal(order.state.isOrdering, true);
});

test("accepts a single IFDOCO submission until its delayed success", (t) => {
    const order = setup(t);

    order.buy("ifdoco");
    order.buy("ifdoco");
    order.sellIFDOCO();
    order.buy("market");

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

    order.buy("ifdoco");
    order.respondTo(order.requests[0]).fail();
    equal(order.state.isOrdering, false);
    deepEqual(order.histories.map(({ status }) => status), ["failed", "failed", "failed"]);

    order.buy("market");
    const marketResponse = order.respondTo(order.requests[1]);
    const staleResponse = order.respondTo(order.requests[0]);
    staleResponse.succeed();
    equal(order.histories.length, 6);
    equal(order.state.isOrdering, true);
    order.buy("ifdoco");
    equal(order.requests.length, 2);

    marketResponse.succeed();
    equal(order.state.isOrdering, false);
    equal(order.histories[0].name, "Market");
    order.buy("ifdoco");
    equal(order.requests.length, 3);
});

for (const outcome of ["succeed", "fail", "disconnect"] as const) {
    const status = { succeed: "success", fail: "failed", disconnect: "unconfirmed" }[outcome];
    const sound = outcome === "succeed" ? "success" : "failure";
    const expectedHistories = ["Stop", "Limit", "Market"].map((name) => ({ name, status }));

    test(`keeps IFDOCO pending after returning from settings until the original request settles (${outcome})`, (t) => {
        const order = setup(t);
        order.buy("ifdoco");
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

    for (const [category, names] of [
        ["market", ["Market"]],
        ["limit", ["Limit"]],
        ["stop", ["Stop"]],
        ["ifdoco", ["Stop", "Limit", "Market"]],
    ] as const) {
        test(`records a pending ${category} order that settles in settings (${outcome})`, async (t) => {
            const order = setup(t);
            order.buy(category);
            deepEqual(order.requests.map(({ category }) => category), [`${category}-order`]);
            const response = order.respondTo(order.requests[0]);

            order.navigate("/setting");
            await flush();
            response.progress();
            deepEqual(order.sounds, []);
            deepEqual(order.histories, []);

            response[outcome]();
            deepEqual(order.sounds, [sound]);
            const histories = names.map((name) => ({ name, status }));
            deepEqual(order.histories.map(({ name, status }) => ({ name, status })), histories);

            order.navigate("/");
            await flush();
            deepEqual(order.sounds, [sound]);
            equal(order.state.isOrdering, false);
            deepEqual(order.histories.map(({ name, status }) => ({ name, status })), histories);
            order.buy(category);
            equal(order.requests.length, 2);
        });
    }
}

const disconnectedOrders = [
    ["market", [["Market", "BUY / 0.01 / MARKET"]]],
    ["stop", [["Stop", "BUY / 0.01 / 110,000"]]],
    ["ifdoco", [
        ["Stop", "SELL / 0.01 / 9,999,999.99"],
        ["Limit", "SELL / 0.01 / 10,000,000"],
        ["Market", "BUY / 0.01 / MARKET"],
    ]],
] as const;

for (const [category, entries] of disconnectedOrders) {
    test(`${category} records an unconfirmed order after a disconnect and permits a later submission`, (t) => {
        const order = setup(t);
        order.buy(category);
        equal(order.state.isOrdering, true);
        order.respondTo(order.requests[0]).disconnect();
        equal(order.state.isOrdering, false);
        deepEqual(
            order.histories.map(({ name, description, status }) => [name, description, status]),
            entries.map((entry) => [...entry, "unconfirmed"]),
        );

        summaryView(Stream.of<SummaryState>({
            ...order.tradeState,
            collateral: 0,
            marketState: { health: "", state: "" },
        })).addListener({ next: (vnode) => match(JSON.stringify(vnode), /"text":"Unconfirmed"/) });

        order.buy(category);
        equal(order.requests.length, 2);
        order.respondTo(order.requests[1]).succeed();
        equal(order.state.isOrdering, false);
        deepEqual(order.histories.map(({ status }) => status), [
            ...entries.map(() => "success"),
            ...entries.map(() => "unconfirmed"),
        ]);
    });
}

test("records a rejected limit order and permits a retry", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1000 });
    const order = setup(t);
    order.enterPrice("900");

    order.buy("limit");
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

    order.buy("limit");
    deepEqual(order.requests.map(({ category }) => category), ["limit-order", "limit-order"]);
    equal(order.state.isOrdering, true);
});

test("dispatches every Clear Orders request and stays locked until they all settle", (t) => {
    const order = setup(t);
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getparentorders", category: "parent-orders", _namespace: ["trade"] }).succeed([
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
    order.buy("market");
    equal(order.requests.length, 3);
    equal(order.state.isOrdering, true);
    deepEqual(Object.keys(order.tradeState.parentStopOrders), ["JCO-failure"]);

    order.respondTo(order.requests[2]).disconnect();
    equal(order.state.isOrdering, false);
    deepEqual(order.sounds, []);
    order.clearOrders();
    deepEqual(order.requests.slice(3).map(({ category }) => category), ["cancel-orders", "cancel-parent-order"]);
    equal(JSON.parse(order.requests[4].send as string).parent_order_id, "JCO-failure");
});

for (const category of ["limit-order", "cancel-orders"] as const) {
    test(`aborts a stalled ${category} and displays it as unconfirmed without retrying`, { timeout: 5_000 }, async (t) => {
        const paths: string[] = [];
        const server = createServer((request, response) => {
            request.resume();
            paths.push(new URL(request.url!, "http://localhost").pathname);
            if (paths.length === 1) {
                return;
            }
            response.end();
        });
        t.after(() => {
            server.closeAllConnections();
            server.close();
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address() as { port: number };
        const order = setup(t, "0.01", { writeOrigin: `http://127.0.0.1:${address.port}` });
        order.enterPrice("10000");
        const submit = category === "limit-order" ? () => order.buy("limit") : order.clearOrders;
        const path = category === "limit-order" ? "/v1/me/sendchildorder" : "/v1/me/cancelallchildorders";

        const receivedFirst = once(server, "request");
        submit();
        submit();
        equal(order.state.isOrdering, true);
        order.navigate("/setting");
        const [, stalledResponse] = await receivedFirst;
        await once(stalledResponse, "close");
        order.navigate("/");
        equal(order.state.isOrdering, false);
        deepEqual(paths, [path]);
        equal(order.requests.length, 1);
        deepEqual(order.histories.map(({ status }) => status), ["unconfirmed"]);
        deepEqual(order.sounds, category === "limit-order" ? ["failure"] : []);
        summaryView(Stream.of<SummaryState>({
            ...order.tradeState,
            collateral: 0,
            marketState: { health: "", state: "" },
        })).addListener({ next: (vnode) => match(JSON.stringify(vnode), /Unconfirmed \(timed out\)/) });

        const received = once(server, "request");
        submit();
        await received;
        deepEqual(paths, [path, path]);
        equal(order.requests.length, 2);
    });
}

for (const route of ["/", "/setting"]) {
    for (const failure of ["deadline", "disconnect"] as const) {
        test(`records an unconfirmed TWAP slice once after a ${failure} on ${route}`, (t) => {
            const order = setup(t);
            const request = twapSliceOrder(0.01, "BUY", Symbol());
            const response = order.respondTo({ ...request, _namespace: ["trade"] });

            if (route === "/setting") order.navigate(route);
            if (failure === "deadline") {
                response.fail(Object.assign(new Error("Deadline exceeded"), { code: "ECONNABORTED", errno: "ETIME" }));
            } else {
                response.disconnect();
            }
            deepEqual(order.histories.map(({ name, status }) => ({ name, status })), [
                { name: "TWAP", status: "unconfirmed" },
            ]);

            if (route === "/setting") order.navigate("/");
            equal(order.histories.length, 1);
            const label = failure === "deadline" ? "Unconfirmed (timed out)" : "Unconfirmed";
            summaryView(Stream.of<SummaryState>({
                ...order.tradeState,
                collateral: 0,
                marketState: { health: "", state: "" },
            })).addListener({ next: (vnode) => equal(JSON.stringify(vnode).includes(`"text":"${label}"`), true) });
        });
    }
}

function setup(t: TestContext, width = "0.01", options: {
    initialPrice?: number | null;
    writeOrigin?: string;
} = {}) {
    const { initialPrice = 10000000, writeOrigin } = options;
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { "api-key": "test", "api-secret": "test" } });
    t.after(() => {
        if (originalStorage) {
            Object.defineProperty(globalThis, "localStorage", originalStorage);
        } else {
            Reflect.deleteProperty(globalThis, "localStorage");
        }
    });

    const buy$ = {
        ifdoco: Stream.create<null>(),
        limit: Stream.create<null>(),
        market: Stream.create<null>(),
        stop: Stream.create<null>(),
    };
    const priceInput$ = Stream.createWithMemory<{ target: { value: string } }>();
    priceInput$.shamefullySendNext({ target: { value: "100000" } });
    const sellIFDOCO$ = Stream.create<null>();
    const clearOrders$ = Stream.create<null>();
    const executionBatch$ = Stream.create<Execution[]>();
    const publishExecution = (price: number) => executionBatch$.shamefullySendNext([{ side: "BUY", price }]);
    const responses$ = Stream.create<MemoryStream<Response> & ResponseStream>();
    const writes$ = Stream.create<RequestInput | null>();
    const transport$ = makeHTTPDriver(250)(writes$).select();
    const source = new MainHTTPSource(Stream.merge(responses$, transport$), "HTTP");
    const state$ = Stream.createWithMemory<{ trade?: TradeState }>();
    const history$ = Stream.createWithMemory<{ pathname: string }>();
    history$.shamefullySendNext({ pathname: "/" });
    const orderEvents = {
        "#price-input": { input: priceInput$ },
        "#trigger-price-input": { input: Stream.of({ target: { value: "110000" } }) },
        ".order-buttons": { ".clear-order-button": { click: clearOrders$ } },
        ".limit-order-buttons": { ".buy-button": { click: buy$.limit } },
        ".market-order-buttons": { ".buy-button": { click: buy$.market } },
        ".stop-order-buttons": { ".buy-button": { click: buy$.stop } },
        ".ranged-ifdoco-order-buttons": {
            ".buy-button": { click: buy$.ifdoco },
            ".sell-button": { click: sellIFDOCO$ },
        },
    };
    const main: Sinks = routerify(Root, switchPath)({
        DOM: mockDOMSource({ ".___trade": new Proxy({}, { get: (_, selector) =>
            typeof selector === "string" && selector.startsWith(".___cycle") ? orderEvents : undefined,
        }) }),
        HTTP: source,
        history: history$,
        socket: {
            board$: Stream.never(),
            childOrderEvent$: Stream.never(),
            execution$: Stream.never(),
            executionBatch$,
            parentOrderEvent$: Stream.never(),
            reconnect$: Stream.never(),
        },
        state: new StateSource(state$, "state"),
        storage: { local: { getItem: (key: string) => Stream.of(key === storageKeys.priceWidth ? width : "0.01") } },
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
        if (["ifdoco-order", "market-order", "limit-order", "stop-order", "cancel-orders", "cancel-parent-order"].includes(options.category as string)) {
            requests.push(options);
            if (writeOrigin) {
                writes$.shamefullySendNext({ ...options, url: writeOrigin + new URL(options.url).pathname });
            }
        }
    } });
    const sounds: Sound[] = [];
    const audio = main.sound!.subscribe({ next: (sound) => sounds.push(sound) });
    if (initialPrice !== null) publishExecution(initialPrice);
    t.after(() => {
        audio.unsubscribe();
        http.unsubscribe();
        reducers.unsubscribe();
    });

    return {
        buy: (category: keyof typeof buy$) => buy$[category].shamefullySendNext(null),
        clearOrders: () => clearOrders$.shamefullySendNext(null),
        enterPrice: (value: string) => priceInput$.shamefullySendNext({ target: { value } }),
        get histories() { return state!.trade!.histories; },
        navigate: (pathname: string) => history$.shamefullySendNext({ pathname }),
        publishExecution,
        requests,
        sounds,
        respondTo(request: RequestOptions) {
            const response$ = Object.assign(Stream.createWithMemory<Response>(), { request: { ...request } });
            responses$.shamefullySendNext(response$);
            return {
                disconnect: () => response$.shamefullySendError(new Error("Disconnected")),
                fail: (error: Error = Object.assign(new Error("Rejected"), { response: { status: 400 } })) =>
                    response$.shamefullySendError(error),
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
