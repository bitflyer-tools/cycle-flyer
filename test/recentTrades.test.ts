import assert from "node:assert/strict";
import {EventEmitter, once} from "node:events";
import {createServer} from "node:http";
import {test} from "node:test";
import type {VNode} from "@cycle/dom";
import type {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {recentTrades} from "../src/components/trade/recentTrades";
import {makeHTTPDriver} from "../src/drivers/httpDriver";

test("renders valid recent trades from history and live updates once per execution", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const responses$ = Stream.create();
    const executionBatch$ = Stream.create();
    const reconnect$ = Stream.create();
    const panel = recentTrades({
        HTTP: { select: (category: string) => {
            assert.equal(category, "recent-trades");
            return responses$;
        } } as any,
        socket: { executionBatch$, reconnect$ } as any,
    });

    let rendered!: VNode;
    const subscription = panel.DOM.subscribe({ next: (value) => { rendered = value; } });
    t.after(() => subscription.unsubscribe());
    assert.match(JSON.stringify(rendered), /No recent trades available/);

    const history = { id: 10, side: "BUY", price: 101, size: 0.1, exec_date: "2025-03-22T09:57:40.397" };
    const live = { ...history, id: 12, side: "", exec_date: "2025-03-22T18:57:41.123+09:00" };
    responses$.shamefullySendNext(Stream.of({ text: JSON.stringify([
        history, null, { ...history, id: -1 }, { ...history, id: 13, size: "0.1" },
        { ...history, id: 14, exec_date: "invalid" },
    ]) }));
    executionBatch$.shamefullySendNext([live, { ...history, side: "SELL" }]);
    t.mock.timers.tick(100);

    const scroll = child(rendered, "div.recent-trades-scroll");
    const table = child(scroll, "table");
    const headers = (child(table, "thead").children as VNode[])[0].children as VNode[];
    assert.deepEqual(headers.map((header) => header.text), ["Time (UTC)", "Side", "Price (JPY)", "Size (BTC-CFD)"]);
    const rows = child(table, "tbody").children as VNode[];
    assert.deepEqual(rows.map((row) => row.key), [12, 10]);
    assert.deepEqual(rows.map((row) => (row.children as VNode[])[1].text), ["—", "BUY"]);
    assert.deepEqual(rows.map((row) => child(child(row, "td"), "time").data?.attrs?.datetime), [
        "2025-03-22T09:57:41.123Z",
        "2025-03-22T09:57:40.397Z",
    ]);
});

test("stops retrying recent trades history when leaving Trade", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const responses$ = Stream.create<Stream<unknown>>();
    const leaveTrade$ = Stream.create<void>();
    const panel = recentTrades({
        HTTP: { select: () => responses$ } as any,
        socket: { executionBatch$: Stream.never(), reconnect$: Stream.never() } as any,
    }, leaveTrade$);
    let requests = 0;
    const http = panel.HTTP.subscribe({ next: () => { requests += 1; } });
    t.after(() => http.unsubscribe());

    responses$.shamefullySendNext(Stream.throw(new Error("Service unavailable")));
    leaveTrade$.shamefullySendNext(undefined);
    t.mock.timers.tick(60_000);
    assert.equal(requests, 1);
});

for (const failure of ["503", "stalled response"]) {
    test(`recovers recent trades history after a ${failure} without reconnecting`, { timeout: 5_000 }, async (t) => {
        const history = { id: 10, side: "BUY", price: 101, size: 0.1, exec_date: "2025-03-22T09:57:40.397" };
        const live = { ...history, id: 12 };
        const executionBatch$ = Stream.create<unknown[]>();
        let attempts = 0;
        const server = createServer((_request, response) => {
            attempts += 1;
            if (attempts === 1) {
                executionBatch$.shamefullySendNext([live]);
                if (failure === "503") { response.writeHead(503).end(); }
                return;
            }
            response.end(JSON.stringify([history, { ...live, side: "SELL" }]));
        });
        t.after(() => {
            server.closeAllConnections();
            server.close();
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as { port: number };
        const requests$ = Stream.create<RequestInput | null>();
        const panel = recentTrades({
            HTTP: makeHTTPDriver(250)(requests$),
            socket: { executionBatch$, reconnect$: Stream.never() } as any,
        });
        const renders = new EventEmitter<{ live: [VNode[]]; recovered: [VNode[]] }>();
        const liveRows = once(renders, "live");
        const recoveredRows = once(renders, "recovered");
        const dom = panel.DOM.subscribe({ next: (view) => {
            if (!(view.children as VNode[]).some((node) => node.sel === "div.recent-trades-scroll")) { return; }
            const rows = child(child(child(view, "div.recent-trades-scroll"), "table"), "tbody").children as VNode[];
            if (rows.length === 1) { renders.emit("live", rows); }
            if (rows.some((row) => row.key === history.id)) { renders.emit("recovered", rows); }
        } });
        const http = panel.HTTP.subscribe({ next: (request) => requests$.shamefullySendNext({
            ...request, url: `http://127.0.0.1:${port}/v1/executions`,
        }) });
        t.after(() => {
            http.unsubscribe();
            dom.unsubscribe();
        });

        const [beforeRecovery]: VNode[][] = await liveRows;
        assert.deepEqual(beforeRecovery.map((row) => row.key), [live.id]);
        const [rows]: VNode[][] = await recoveredRows;
        assert.deepEqual(rows.map((row) => row.key), [live.id, history.id]);
        assert.equal((rows[0].children as VNode[])[1].text, live.side);
        assert.equal(attempts, 2);
    });
}

function child(parent: VNode, selector: string): VNode {
    const node = (parent.children as VNode[] | undefined)?.find((item) => item.sel === selector);
    assert.ok(node, `Expected ${selector} inside ${parent.sel}`);
    return node;
}
