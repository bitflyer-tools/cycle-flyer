import {VNode} from "@cycle/dom";
import {deepStrictEqual} from "node:assert/strict";
import {test} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/board";
import {model} from "../src/components/trade/board/model";
import {view} from "../src/components/trade/board/view";
import {Board} from "../src/models/board";
import {Position} from "../src/models/position";
import {StopOrder} from "../src/models/stopOrder";

test("renders the final grouping and price rows after two Group + clicks", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const plus$ = Stream.create<null>();
    const reducers$ = model({
        onClickAsk$: Stream.never(),
        onClickBid$: Stream.never(),
        onClickGroupSizePlusButton$: plus$,
        onClickGroupSizeMinusButton$: Stream.never(),
        onGroupSizeLoaded$: Stream.never(),
    }, Stream.never());
    const state$ = reducers$.fold((state, reducer) => reducer(state)!, { ...boardState(), groupedSize: 1 }).drop(1);
    const rendered: VNode[] = [];
    const subscription = view(state$).subscribe({ next: (board) => rendered.push(board) });

    plus$.shamefullySendNext(null);
    plus$.shamefullySendNext(null);
    context.mock.timers.tick(99);
    deepStrictEqual(rendered.map(groupingAndPrices), [["1", [105, 115], [105, 95]]]);
    context.mock.timers.tick(1);
    deepStrictEqual(rendered.map(groupingAndPrices), [
        ["1", [105, 115], [105, 95]],
        ["100", [200], [100, 0]],
    ]);
    context.mock.timers.tick(100);
    deepStrictEqual(rendered.length, 2);
    subscription.unsubscribe();
    context.mock.timers.tick(0);
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
            ["div.ask", 110, [["span.my-order", "0.75"]]],
            ["div.ask", 120, [["span.my-stop-order", "12"]]],
            ["div.bid", 100, [["span.my-order", "3"]]],
            ["div.bid", 90, [["span.my-stop-order", "48"]]],
        ]),
    });
});

test("renders stops at 125 on the visible rows with grouping of 50", () => {
    const board = new Board({ asks: [{ price: 125, size: 1 }], bids: [{ price: 124, size: 1 }] });
    const stopOrders = [
        new StopOrder({ side: "BUY", price: 125, size: 2 }),
        new StopOrder({ side: "SELL", price: 125, size: 3 }),
    ];

    view(Stream.of({ ...boardState(), board, groupedSize: 50, stopOrders })).addListener({
        next: (rendered) => deepStrictEqual(markers(rendered), [
            ["div.ask", 150, [["span.my-stop-order", "2"]]],
            ["div.bid", 100, [["span.my-stop-order", "3"]]],
        ]),
    });
});

test("reuses marker totals until their order list or group size changes", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
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

function groupingAndPrices(board: VNode) {
    const [header, asks, bids] = board.children as VNode[];
    const grouping = (header.children as VNode[]).find((child) => child.sel === "span.grouped-size");
    const prices = (side: VNode) => (side.children as VNode[]).map((row) => row.data?.dataset?.price);
    return [grouping?.text, prices(asks), prices(bids)];
}

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
