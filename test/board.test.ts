import {VNode} from "@cycle/dom";
import {deepStrictEqual} from "node:assert/strict";
import {test} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/board";
import {view} from "../src/components/trade/board/view";
import {Board} from "../src/models/board";
import {Position} from "../src/models/position";
import {StopOrder} from "../src/models/stopOrder";

test("renders a spread only when both sides have a quote", () => {
    const ask = { price: 110, size: 1 };
    const bid = { price: 100, size: 1 };
    const cases = [
        { asks: [], bids: [], spread: undefined, displayedSpread: "—" },
        { asks: [], bids: [bid], spread: undefined, displayedSpread: "—" },
        { asks: [ask], bids: [], spread: undefined, displayedSpread: "—" },
        { asks: [ask], bids: [bid], spread: 10, displayedSpread: "10" },
        { asks: [bid], bids: [bid], spread: 0, displayedSpread: "0" },
    ];

    cases.forEach(({ asks, bids, spread, displayedSpread }) => {
        const board = new Board({ asks, bids });
        deepStrictEqual(board.spread(), spread);
        const renderedSpreads: Array<string | undefined> = [];
        view(Stream.of({ ...boardState(), board, groupedSize: 100 })).addListener({
            next: (rendered) => {
                const [header] = rendered.children as VNode[];
                const spreadNode = (header.children as VNode[]).find((node) => node.sel === "span.spread");
                renderedSpreads.push(spreadNode?.text);
            },
        });
        deepStrictEqual(renderedSpreads, [displayedSpread]);
    });
});

test("renders summed active and stop markers on their display sides", () => {
    const state = boardState();
    const orders = [
        { side: "SELL", price: 101, size: 0.5 },
        { side: "SELL", price: 109, size: 0.25 },
        { side: "BUY", price: 101, size: 1 },
        { side: "BUY", price: 109, size: 2 },
    ];
    const stopOrders = [
        { side: "BUY", price: 111, size: 4 },
        { side: "BUY", price: 119, size: 8 },
        { side: "SELL", price: 91, size: 16 },
        { side: "SELL", price: 99, size: 32 },
        { side: "BUY", price: 300, size: 64 },
    ].map((order) => new StopOrder(order));

    view(Stream.of({ ...state, orders, stopOrders })).addListener({
        next: (board) => deepStrictEqual(markers(board), [
            ["div.ask", 110, [["span.my-order", "0.75"], ["span.my-stop-order", "12"]]],
            ["div.ask", 120, []],
            ["div.bid", 100, [["span.my-order", "3"], ["span.my-stop-order", "48"]]],
            ["div.bid", 90, []],
        ]),
    });
});

test("reuses marker totals until their order list or group size changes", (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const reads = { active: 0, stop: 0 };
    const orders = [{
        side: "SELL",
        get price() {
            reads.active++;
            return 105;
        },
        size: 1,
    }];
    const stop = new StopOrder({ side: "BUY", price: 115, size: 2 });
    Object.defineProperty(stop, "price", {
        get: () => {
            reads.stop++;
            return 115;
        },
    });
    const state = { ...boardState(), orders, stopOrders: [stop] };
    const state$ = Stream.create<State>();
    const rendered: VNode[] = [];
    view(state$).addListener({ next: (board) => rendered.push(board) });

    state$.shamefullySendNext(state);
    deepStrictEqual(reads, { active: 1, stop: 1 });
    context.mock.timers.tick(100);
    state$.shamefullySendNext({ ...state, board: boardState().board });
    deepStrictEqual(reads, { active: 1, stop: 1 });
    context.mock.timers.tick(100);
    const updatedOrders = { ...state, orders: [...orders] };
    state$.shamefullySendNext(updatedOrders);
    deepStrictEqual(reads, { active: 2, stop: 1 });
    context.mock.timers.tick(100);
    const updatedStops = { ...updatedOrders, stopOrders: [...state.stopOrders] };
    state$.shamefullySendNext(updatedStops);
    deepStrictEqual(reads, { active: 2, stop: 2 });
    context.mock.timers.tick(100);
    state$.shamefullySendNext({ ...updatedStops, groupedSize: 5 });
    deepStrictEqual(reads, { active: 3, stop: 3 });
    deepStrictEqual(markers(rendered[4])[0], ["div.ask", 105, [["span.my-order", "1"]]]);
    state$.shamefullySendComplete();
});

function boardState(): State {
    return {
        board: new Board({
            asks: [{ price: 105, size: 1 }, { price: 115, size: 1 }],
            bids: [{ price: 105, size: 1 }, { price: 95, size: 1 }],
        }),
        currentPrice: 0,
        groupedSize: 10,
        orders: [],
        position: new Position([]),
        price: 0,
        stopOrders: [],
    };
}

function markers(board: VNode) {
    const [, asks, bids] = board.children as VNode[];
    return (asks.children as VNode[]).concat(bids.children as VNode[]).map((row) => [
        row.sel,
        row.data?.dataset?.price,
        (row.children as VNode[])
            .filter((child) => child?.sel === "span.my-order" || child?.sel === "span.my-stop-order")
            .map((child) => [child.sel, child.text]),
    ]);
}
