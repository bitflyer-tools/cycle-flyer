import assert from "node:assert/strict";
import {test} from "node:test";
import type {VNode} from "@cycle/dom";
import Stream from "xstream";
import {recentTrades} from "../src/components/trade/recentTrades";

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
    const rows = child(child(scroll, "table"), "tbody").children as VNode[];
    assert.deepEqual(rows.map((row) => row.key), [12, 10]);
    assert.deepEqual(rows.map((row) => (row.children as VNode[])[1].text), ["—", "BUY"]);
    assert.deepEqual(rows.map((row) => child(child(row, "td"), "time").data?.attrs?.datetime), [
        "2025-03-22T09:57:41.123Z",
        "2025-03-22T09:57:40.397Z",
    ]);
});

function child(parent: VNode, selector: string): VNode {
    const node = (parent.children as VNode[] | undefined)?.find((item) => item.sel === selector);
    assert.ok(node, `Expected ${selector} inside ${parent.sel}`);
    return node;
}
