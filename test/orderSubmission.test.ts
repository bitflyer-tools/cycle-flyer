import {mockDOMSource} from "@cycle/dom";
import {RequestOptions, Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import {deepEqual, equal} from "node:assert/strict";
import {test, TestContext} from "node:test";
import Stream from "xstream";
import {Sources} from "../src/components/trade";
import {OrderComponent, State} from "../src/components/trade/order";

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
    deepEqual(order.state.histories.map(({ status }) => status), ["success", "success", "success"]);

    order.sellIFDOCO();
    equal(order.requests.length, 2);
    equal(JSON.parse(order.requests[1].send as string).parameters[0].side, "SELL");
    const sellResponse = order.respondTo(order.requests[1]);
    order.respondTo(order.requests[0]).succeed();
    equal(order.state.isOrdering, true);

    sellResponse.succeed();
    equal(order.state.isOrdering, false);
    equal(order.state.histories.length, 9);
});

test("releases a failed IFDOCO and keeps a later market order locked through stale responses", (t) => {
    const order = setup(t);

    order.buyIFDOCO();
    order.respondTo(order.requests[0]).fail();
    equal(order.state.isOrdering, false);
    deepEqual(order.state.histories.map(({ status }) => status), ["failed", "failed", "failed"]);

    order.buyMarket();
    const marketResponse = order.respondTo(order.requests[1]);
    const staleResponse = order.respondTo(order.requests[0]);
    staleResponse.succeed();
    equal(order.state.histories.length, 6);
    equal(order.state.isOrdering, true);
    order.buyIFDOCO();
    equal(order.requests.length, 2);

    marketResponse.succeed();
    equal(order.state.isOrdering, false);
    equal(order.state.histories[0].name, "Market");
    order.buyIFDOCO();
    equal(order.requests.length, 3);
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
    const responses$ = Stream.create<Stream<Response> & { request: RequestOptions }>();
    const state$ = Stream.createWithMemory<State>();
    const sinks = OrderComponent({
        DOM: mockDOMSource({
            ".market-order-buttons": { ".buy-button": { click: buyMarket$ } },
            ".ranged-ifdoco-order-buttons": {
                ".buy-button": { click: buyIFDOCO$ },
                ".sell-button": { click: sellIFDOCO$ },
            },
        }),
        HTTP: { select: (category?: string) => responses$.filter(({ request }) =>
            !category || request.category === category) },
        state: { stream: state$ },
        storage: { local: { getItem: () => Stream.of("0.01") } },
    } as unknown as Sources);

    let state: State | undefined;
    const reducers = (sinks.state as unknown as Stream<Reducer<State>>).subscribe({
        next: (reduce) => {
            state = reduce(state);
            if (state) {
                state$.shamefullySendNext(state);
            }
        },
    });
    const requests: RequestOptions[] = [];
    const http = sinks.HTTP.subscribe({ next: (request) => requests.push(request as RequestOptions) });
    t.after(() => {
        http.unsubscribe();
        reducers.unsubscribe();
    });

    return {
        buyIFDOCO: () => buyIFDOCO$.shamefullySendNext(null),
        buyMarket: () => buyMarket$.shamefullySendNext(null),
        requests,
        respondTo(request: RequestOptions) {
            const response$ = Object.assign(Stream.create<Response>(), { request: { ...request } });
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
        get state() { return state!; },
    };
}
