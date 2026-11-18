import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {test, TestContext} from "node:test";
import {RequestOptions} from "@cycle/http";
import {StateSource} from "@cycle/state";
import Stream from "xstream";
import {Execution, ExecutionsComponent, State} from "../src/components/trade/executions";
import {executionPageSize, getExecutions} from "../src/http";

const execution = (id: number): Execution => ({
    id,
    exec_date: "2025-03-22T09:57:40.397",
    side: id % 2 ? "BUY" : "SELL",
    price: 12000000,
    size: 0.00000001,
    child_order_acceptance_id: "JRF20250322-095740-000001",
});

function setup(t: TestContext, credentials = true) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: credentials ? { "api-key": "test-key", "api-secret": "test-secret" } : {},
    });
    t.after(() => {
        if (previous) { Object.defineProperty(globalThis, "localStorage", previous); }
        else { Reflect.deleteProperty(globalThis, "localStorage"); }
    });

    const refresh$ = Stream.create();
    const older$ = Stream.create();
    const responses$ = Stream.create();
    const state$ = Stream.create<State>().remember();
    const sinks = ExecutionsComponent({
        DOM: { select: (selector: string) => ({
            events: () => selector === ".refresh-executions" ? refresh$ : older$,
        }) } as any,
        HTTP: { select: (category: string) => {
            assert.equal(category, "executions");
            return responses$;
        } } as any,
        state: new StateSource(state$, "state"),
    });

    let current!: State;
    let dom: unknown;
    const requests: RequestOptions[] = [];
    const subscriptions = [
        sinks.DOM.subscribe({ next: (value) => { dom = value; } }),
        sinks.state.subscribe({ next: (reducer) => {
            current = reducer(current)!;
            state$.shamefullySendNext(current);
        } }),
        sinks.HTTP.subscribe({ next: (value) => requests.push(value) }),
    ];
    t.after(() => subscriptions.forEach((subscription) => subscription.unsubscribe()));

    const respond = <T>(response$: Stream<T>) => responses$.shamefullySendNext(
        Object.assign(response$, { request: requests[requests.length - 1] }),
    );
    return {
        requests,
        refresh: () => refresh$.shamefullySendNext(null),
        older: () => older$.shamefullySendNext(null),
        page: (rows: Execution[]) => respond(Stream.of({ text: JSON.stringify(rows) })),
        fail: (error: object) => respond(Stream.throw(error)),
        get state() { return current; },
        get dom() { return JSON.stringify(dom); },
    };
}

test("signs the newest and older private FX execution requests", (t) => {
    setup(t);
    [undefined, 41].forEach((before) => {
        const request = getExecutions(before)!;
        const path = "/v1/me/getexecutions";
        const query = `?product_code=FX_BTC_JPY&count=${executionPageSize}` +
            (before === undefined ? "" : "&before=41");
        const headers = request.headers as Record<string, string>;
        assert.equal(request.url, "https://api.bitflyer.jp" + path);
        assert.equal(request.method, "GET");
        assert.deepEqual(request.query, {
            product_code: "FX_BTC_JPY", count: executionPageSize, ...(before === undefined ? {} : { before }),
        });
        assert.equal(headers["ACCESS-KEY"], "test-key");
        assert.equal(headers["ACCESS-SIGN"], createHmac("sha256", "test-secret")
            .update(headers["ACCESS-TIMESTAMP"] + "GET" + path + query).digest("hex"));
    });
});

test("loads on demand, appends older fills and replaces the list on refresh", (t) => {
    const panel = setup(t);
    panel.older();
    assert.equal(panel.requests.length, 0);
    panel.refresh();
    panel.refresh();
    assert.equal(panel.requests.length, 1);
    assert.equal(panel.state.loading, true);

    panel.page(Array.from({ length: executionPageSize }, (_, index) => execution(10 + index)));
    assert.equal(panel.state.rows[0].id, executionPageSize + 9);
    assert.equal(panel.state.before, 10);
    assert.match(panel.dom, /2025-03-22T09:57:40.397/);
    assert.match(panel.dom, /BUY/);
    assert.match(panel.dom, /12,000,000|12000000/);
    assert.match(panel.dom, /1e-8/);
    assert.match(panel.dom, /JRF20250322-095740-000001/);

    panel.older();
    assert.equal((panel.requests[1].query as {before: number}).before, 10);
    panel.page([execution(10), execution(8), execution(9)]);
    assert.deepEqual(panel.state.rows.slice(-3).map((row) => row.id), [10, 9, 8]);
    panel.older();
    assert.equal(panel.requests.length, 2);

    panel.refresh();
    assert.equal(Object.prototype.hasOwnProperty.call(panel.requests[2].query, "before"), false);
    panel.page([]);
    assert.deepEqual(panel.state.rows, []);
    assert.match(panel.dom, /No executions found/);
});

test("reports permission failures and lets users retry without losing loaded fills", (t) => {
    const panel = setup(t);
    panel.refresh();
    panel.page([execution(1)]);
    panel.refresh();
    panel.fail({ status: 400, response: { body: { error_message: "Permission denied" } } });
    assert.match(panel.dom, /permission to read executions/);
    assert.equal(panel.state.loading, false);
    assert.deepEqual(panel.state.rows, [execution(1)]);
    panel.refresh();
    panel.fail(new Error("Network error"));
    assert.match(panel.dom, /Could not load executions/);
    panel.refresh();
    panel.page([execution(2)]);
    assert.equal(panel.state.error, undefined);
    assert.deepEqual(panel.state.rows, [execution(2)]);
});

test("explains missing credentials without sending a request", (t) => {
    const panel = setup(t, false);
    panel.refresh();
    assert.equal(panel.requests.length, 0);
    assert.match(panel.dom, /Set an API key and secret/);
});
