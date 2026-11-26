import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {once} from "node:events";
import {createServer, ServerResponse} from "node:http";
import {test, TestContext} from "node:test";
import {VNode} from "@cycle/dom";
import {RequestInput, RequestOptions} from "@cycle/http";
import {StateSource} from "@cycle/state";
import Stream from "xstream";
import {Execution, ExecutionsComponent, State, toCsv} from "../src/components/trade/executions";
import {saveCredentials} from "../src/credentials";
import {authorizeRequest, makeHTTPDriver, unsignedRequests$} from "../src/drivers/httpDriver";
import {executionPageSize, getExecutions} from "../src/http";

const execution = (id: number): Execution => ({
    id,
    exec_date: "2025-03-22T09:57:40.397",
    side: id % 2 ? "BUY" : "SELL",
    price: 12000000,
    size: 0.00000001,
    child_order_acceptance_id: "JRF20250322-095740-000001",
});

async function setup(t: TestContext, credentials = true, origin?: string) {
    await saveCredentials(credentials ? { key: "test-key", secret: "test-secret" } : null);
    t.after(() => saveCredentials(null));

    const refresh$ = Stream.create();
    const older$ = Stream.create();
    const scroll$ = Stream.create();
    const exportCsv$ = Stream.create();
    const responses$ = Stream.create();
    const transport$ = Stream.create<RequestInput | null>();
    const state$ = Stream.create<State>().remember();
    const sinks = ExecutionsComponent({
        DOM: { select: (selector: string) => ({
            events: () => ({
                ".refresh-executions": refresh$,
                ".load-older-executions": older$,
                ".executions-scroll": scroll$,
                ".export-executions-csv": exportCsv$,
            })[selector],
        }) } as any,
        HTTP: origin ? makeHTTPDriver(250)(transport$) : { select: (category: string) => {
            assert.equal(category, "executions");
            return responses$;
        } } as any,
        state: new StateSource(state$, "state"),
    });

    let current!: State;
    let dom: VNode;
    const requests: RequestOptions[] = [];
    const subscriptions = [
        sinks.DOM.subscribe({ next: (value) => { dom = value; } }),
        sinks.state.subscribe({ next: (reducer) => {
            current = reducer(current)!;
            state$.shamefullySendNext(current);
        } }),
        sinks.HTTP.subscribe({ next: (value) => {
            requests.push(value);
            if (!origin) { return; }
            const url = new URL(value.url);
            transport$.shamefullySendNext({ ...value, url: origin + url.pathname + url.search });
        } }),
    ];
    t.after(() => subscriptions.forEach((subscription) => subscription.unsubscribe()));

    const respond = <T>(response$: Stream<T>) => responses$.shamefullySendNext(
        Object.assign(response$, { request: requests[requests.length - 1] }),
    );
    return {
        requests,
        failSigning: () => unsignedRequests$.shamefullySendNext(requests.at(-1)!),
        refresh: () => refresh$.shamefullySendNext(null),
        older: () => older$.shamefullySendNext(null),
        exportCsv: () => exportCsv$.shamefullySendNext(null),
        scroll: (scrollTop: number) => scroll$.shamefullySendNext({ target: { scrollTop } }),
        page: (rows: Execution[]) => respond(Stream.of({ text: JSON.stringify(rows) })),
        fail: (error: object) => respond(Stream.throw(error)),
        settled: () => new Promise<State>((resolve) =>
            state$.filter((value) => !value.loading).take(1).addListener({ next: resolve })),
        disabled: (selector: string) =>
            dom.children?.find((child): child is VNode => typeof child === "object" && child.sel === selector)
                ?.data?.props?.disabled,
        get state() { return current; },
        get dom() { return JSON.stringify(dom); },
        get tableRows() {
            const scroll = dom.children?.find((child) => typeof child === "object" && child?.sel === "div.executions-scroll") as VNode;
            const table = scroll.children![0] as VNode;
            return (table.children![1] as VNode).children as VNode[];
        },
        get tableHeaders() {
            const scroll = dom.children?.find((child) => typeof child === "object" && child?.sel === "div.executions-scroll") as VNode;
            const table = scroll.children![0] as VNode;
            const headerRow = (table.children![0] as VNode).children![0] as VNode;
            return (headerRow.children as VNode[]).map((header) => header.text);
        },
    };
}

for (const older of [false, true]) {
    test(`times out a stalled ${older ? "older page" : "initial load"} and accepts a retry`, { timeout: 5_000 }, async (t) => {
        const firstPage = Array.from({ length: executionPageSize }, (_, index) => execution(10 + index));
        const retryPage = [execution(9)];
        const cursors: (string | null)[] = [];
        let stalled: ServerResponse;
        const server = createServer((request, response) => {
            cursors.push(new URL(request.url!, "http://localhost").searchParams.get("before"));
            if (older && cursors.length === 1) {
                response.end(JSON.stringify(firstPage));
            } else if (cursors.length === (older ? 2 : 1)) {
                stalled = response;
            } else {
                stalled.end(JSON.stringify([execution(8)]));
                response.end(JSON.stringify(retryPage));
            }
        });
        t.after(() => {
            server.closeAllConnections();
            server.close();
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as { port: number };
        const panel = await setup(t, true, `http://127.0.0.1:${port}`);
        if (older) {
            panel.refresh();
            await panel.settled();
        }
        const rows = panel.state.rows;
        const load = older ? panel.older : panel.refresh;
        const received = once(server, "request");
        load();
        assert.equal(panel.state.loading, true);
        const settled = panel.settled();
        const [, response] = await received;
        await Promise.all([settled, once(response, "close")]);
        assert.match(panel.dom, /Could not load executions. Try again/);
        assert.equal(panel.state.loading, false);
        assert.deepEqual(panel.state.rows, rows);
        assert.equal(panel.state.before, older ? 10 : undefined);
        assert.equal(panel.disabled("button.refresh-executions"), false);
        assert.equal(panel.disabled("button.load-older-executions"), !older);

        load();
        await panel.settled();
        assert.equal(panel.state.error, undefined);
        assert.deepEqual(panel.state.rows, [...rows, ...retryPage]);
        assert.deepEqual(cursors, older ? [null, "10", "10"] : [null, null]);
    });
}

test("signs the newest and older private FX execution requests", async (t) => {
    await setup(t);
    for (const before of [undefined, 41]) {
        const request = await authorizeRequest(getExecutions(before)) as RequestOptions;
        const path = "/v1/me/getexecutions";
        const query = `?product_code=FX_BTC_JPY&count=${executionPageSize}` +
            (before === undefined ? "" : "&before=41");
        const headers = request.headers as Record<string, string>;
        assert.equal(request.url, "https://api.bitflyer.jp" + path + query);
        assert.equal(request.method, "GET");
        assert.equal(headers["ACCESS-KEY"], "test-key");
        assert.equal(headers["ACCESS-SIGN"], createHmac("sha256", "test-secret")
            .update(headers["ACCESS-TIMESTAMP"] + "GET" + path + query).digest("hex"));
    }
});

test("loads on demand, appends older fills and replaces the list on refresh", async (t) => {
    const panel = await setup(t);
    panel.older();
    assert.equal(panel.requests.length, 0);
    panel.refresh();
    panel.refresh();
    assert.equal(panel.requests.length, 1);
    assert.equal(panel.state.loading, true);

    panel.page(Array.from({ length: executionPageSize }, (_, index) => execution(10 + index)));
    assert.equal(panel.state.rows[0].id, executionPageSize + 9);
    assert.equal(panel.state.before, 10);
    assert.deepEqual(panel.tableHeaders, ["Exchange time", "Side", "Price (JPY)", "Size (BTC-CFD)", "Order acceptance ID"]);
    assert.match(panel.dom, /2025-03-22T09:57:40.397/);
    assert.match(panel.dom, /BUY/);
    assert.match(panel.dom, /12,000,000|12000000/);
    assert.match(panel.dom, /1e-8/);
    assert.match(panel.dom, /JRF20250322-095740-000001/);

    const loadedRows = panel.state.rows.slice();
    panel.older();
    assert.equal(new URL(panel.requests[1].url!).searchParams.get("before"), "10");
    panel.page([execution(10), execution(8), execution(100), execution(9), execution(8)]);
    assert.deepEqual(panel.state.rows, [...loadedRows, execution(9), execution(8)]);
    panel.older();
    assert.equal(panel.requests.length, 2);

    panel.refresh();
    assert.equal(new URL(panel.requests[2].url).searchParams.has("before"), false);
    panel.page([]);
    assert.deepEqual(panel.state.rows, []);
    assert.match(panel.dom, /No executions found/);
});

test("windows 5,000 retained fills across the scroll range and only formats mounted fills while loading", async (t) => {
    const panel = await setup(t);
    const total = 5000;
    panel.refresh();
    for (let first = total; first > 0; first -= executionPageSize) {
        panel.page(Array.from({ length: executionPageSize }, (_, index) => execution(first - index)));
        if (first > executionPageSize) { panel.older(); }
    }
    assert.equal(panel.state.rows.length, total);

    const seen = new Set();
    for (let offset = 0; offset < total; offset += 8) {
        panel.scroll(offset * 28);
        const rows = panel.tableRows;
        assert.ok(rows.length <= 21);
        rows.filter(({ sel }) => sel === "tr").forEach(({ key }) => seen.add(key));
        const spacerHeight = (spacer: VNode) => Number.parseInt(
            (spacer.children![0] as VNode).data!.style!.height, 10);
        assert.equal(spacerHeight(rows[0]) + spacerHeight(rows.at(-1)!) + (rows.length - 2) * 28, total * 28);
    }
    assert.equal(seen.size, total);
    assert.equal(panel.tableRows.at(-2)?.key, 1);

    const formatted: number[] = [];
    panel.state.rows.forEach((fill) => {
        const price = fill.price;
        Object.defineProperty(fill, "price", { get: () => { formatted.push(fill.id); return price; } });
    });
    panel.older();
    assert.equal(panel.state.loading, true);
    assert.deepEqual(formatted, panel.tableRows.filter(({ sel }) => sel === "tr").map(({ key }) => key));
    panel.page([execution(0)]);
    assert.ok(panel.tableRows.some(({ key }) => key === 1));

    panel.refresh();
    panel.page([execution(6000)]);
    assert.deepEqual(panel.tableRows.filter(({ sel }) => sel === "tr").map(({ key }) => key), [6000]);
});

test("reports permission failures and lets users retry without losing loaded fills", async (t) => {
    const panel = await setup(t);
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
    panel.failSigning();
    assert.match(panel.dom, /Could not sign the executions request/);
    assert.equal(panel.state.loading, false);
    panel.refresh();
    panel.page([execution(2)]);
    assert.equal(panel.state.error, undefined);
    assert.deepEqual(panel.state.rows, [execution(2)]);
});

test("explains missing credentials without sending a request", async (t) => {
    const panel = await setup(t, false);
    panel.refresh();
    assert.equal(panel.requests.length, 0);
    assert.match(panel.dom, /Set an API key and secret/);
});

test("serializes rows to CSV with a header row and escaped fields", () => {
    const rows: Execution[] = [
        execution(1),
        { ...execution(2), child_order_acceptance_id: "JRF,\"2025\"" },
    ];
    assert.equal(toCsv(rows), [
        "Exchange time,Side,Price (JPY),Size (BTC-CFD),Order acceptance ID",
        "2025-03-22T09:57:40.397,BUY,12000000,1e-8,JRF20250322-095740-000001",
        "2025-03-22T09:57:40.397,SELL,12000000,1e-8,\"JRF,\"\"2025\"\"\"",
        "",
    ].join("\r\n"));
});

test("disables CSV export until executions have loaded, then downloads a CSV on click", async (t) => {
    const panel = await setup(t);
    assert.equal(panel.disabled("button.export-executions-csv"), true);

    panel.exportCsv();
    panel.refresh();
    panel.page([execution(2), execution(1)]);
    assert.equal(panel.disabled("button.export-executions-csv"), false);

    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const link = { href: "", download: "", clicked: 0, click() { this.clicked++; } };
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { createElement: (tag: string) => { assert.equal(tag, "a"); return link; } },
    });
    t.after(() => {
        if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
        else delete (globalThis as any).document;
    });

    panel.exportCsv();
    assert.equal(link.clicked, 1);
    assert.equal(link.download, "executions.csv");
    assert.match(link.href, /^blob:/);
});
