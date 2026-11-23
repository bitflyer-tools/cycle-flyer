import {Response} from "@cycle/http";
import {strict as assert} from "node:assert";
import {test} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/board";
import {request as pollBoard} from "../src/components/trade/board/request";
import {synchronizeBoard} from "../src/components/trade/board/synchronizeBoard";
import {Board, BoardLevels} from "../src/models/board";
import {BoardOrder} from "../src/models/boardOrder";
import {Execution} from "../src/models/execution";
import {estimateMarketFills} from "../src/models/marketFill";

test("replays realtime changes over a delayed snapshot", () => {
    const {request, update, asks} = setup();
    const respond = request();

    update(100, 0);
    update(102, 2);
    update(102, 3);
    respond([{ price: 100, size: 1 }, { price: 101, size: 4 }, { price: 102, size: 1 }]);

    assert.deepEqual(asks(), [[101, 4], [102, 3]]);
});

test("installs snapshots that consistently arrive after the next poll", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const {request, update, asks} = setup();
    let poll = 0;
    const subscription = pollBoard(Stream.of(true)).subscribe({
        next: () => {
            const respond = request();
            const size = ++poll;
            setTimeout(() => respond([{ price: 100, size }]), 16_000);
        },
    });
    t.after(() => subscription.unsubscribe());

    await Promise.resolve();
    t.mock.timers.tick(15_000);
    assert.equal(poll, 2);
    assert.deepEqual(asks(), []);
    update(101, 3);
    t.mock.timers.tick(1_000);
    assert.deepEqual(asks(), [[100, 1], [101, 3]]);
    t.mock.timers.tick(14_000);
    assert.equal(poll, 3);
    assert.deepEqual(asks(), [[100, 1], [101, 3]]);
    t.mock.timers.tick(1_000);
    assert.deepEqual(asks(), [[100, 2], [101, 3]]);
});

test("expires a stalled snapshot while a later refresh is pending", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const {request, asks} = setup();
    const respondStalled = request();

    t.mock.timers.tick(15_000);
    const respondLater = request();
    t.mock.timers.tick(15_001);
    respondStalled([{ price: 100, size: 1 }]);
    assert.deepEqual(asks(), []);

    respondLater([{ price: 101, size: 2 }]);
    assert.deepEqual(asks(), [[101, 2]]);
});

test("installs a 100-delta snapshot with one sort per side", () => {
    const {request, sendDelta, board} = setup();
    const levels = {
        asks: Array.from({ length: 1000 }, (_, index) => ({ price: 2999 - index, size: 1 })),
        bids: Array.from({ length: 1000 }, (_, index) => ({ price: 1000 + index, size: 1 })),
    };
    const expected = new Board(levels);
    const respond = request();
    Array.from({ length: 100 }, (_, index) => {
        const size = index % 3 === 1 ? 0 : index + 2;
        const delta = index % 2 === 0
            ? { asks: [{ price: 2000, size }], bids: [] }
            : { asks: [], bids: [{ price: 1999, size }] };
        sendDelta(delta);
        expected.merge(delta.asks, delta.bids);
    });

    const sort = Array.prototype.sort;
    let askSorts = 0;
    let bidSorts = 0;
    Array.prototype.sort = function<T>(this: T[], compare?: (a: T, b: T) => number): T[] {
        const first = this[0] as BoardOrder | undefined;
        if (first && first.price >= 2000) { askSorts++; }
        if (first && first.price < 2000) { bidSorts++; }
        return sort.call(this, compare);
    };
    try {
        respond(levels.asks, levels.bids);
    } finally {
        Array.prototype.sort = sort;
    }
    assert.equal(askSorts, 1);
    assert.equal(bidSorts, 1);
    assert.deepEqual(board(), expected);
});

test("preserves duplicate levels within each snapshot or delta", () => {
    const {request, sendDelta, asks} = setup();
    const respond = request();
    sendDelta({
        asks: [{ price: 102, size: 4 }, { price: 102, size: 0 }, { price: 102, size: 5 }],
        bids: [],
    });
    respond([
        { price: 101, size: 1 }, { price: 102, size: 1 },
        { price: 101, size: 2 }, { price: 102, size: 2 },
    ]);

    assert.deepEqual(asks(), [[101, 1], [101, 2], [102, 4], [102, 5]]);
});

test("keeps both sides best first after replaying a one-sided delta", () => {
    const {request, update, board} = setup();
    const respond = request();

    update(110, 3);
    respond([], JSON.stringify({
        asks: [{ price: 130, size: 1 }, { price: 120, size: 2 }],
        bids: [{ price: 90, size: 1 }, { price: 100, size: 2 }],
    }));

    assert.deepEqual(board().asks.map(({price}) => price), [110, 120, 130]);
    assert.deepEqual(board().bids.map(({price}) => price), [100, 90]);
    assert.equal(board().spread(), 10);
});

test("initializes from a fresh snapshot and applies subsequent realtime updates", () => {
    const {request, update, asks} = setup();
    request()([{ price: 100, size: 1 }]);
    assert.deepEqual(asks(), [[100, 1]]);

    update(100, 0);
    assert.deepEqual(asks(), []);
});

test("preserves both sides for auction executions live and during snapshot replay", () => {
    const {request, execute, asks, bids} = setup();
    const initialAsks = [{ price: 110, size: 1 }, { price: 120, size: 2 }];
    const initialBids = [{ price: 105, size: 3 }, { price: 95, size: 4 }];
    request()(initialAsks, initialBids);
    const respond = request();

    execute({ side: "", price: 100 });
    assert.deepEqual(asks(), [[110, 1], [120, 2]]);
    assert.deepEqual(bids(), [[105, 3], [95, 4]]);

    respond(initialAsks, initialBids);
    assert.deepEqual(asks(), [[110, 1], [120, 2]]);
    assert.deepEqual(bids(), [[105, 3], [95, 4]]);
});

test("prunes both sides for directional executions in a mixed batch live and during snapshot replay", () => {
    const {request, execute, asks, bids, board} = setup();
    const initialAsks = [{ price: 100, size: 1 }, { price: 110, size: 2 }];
    const initialBids = [{ price: 95, size: 1 }, { price: 90, size: 2 }];
    request()(initialAsks, initialBids);
    const respond = request();

    execute({ side: "BUY", price: 110 }, { side: "", price: 85 }, { side: "SELL", price: 90 });
    assert.deepEqual(asks(), [[110, 2]]);
    assert.deepEqual(bids(), [[90, 2]]);

    respond(initialAsks, initialBids);
    assert.deepEqual(asks(), [[110, 2]]);
    assert.deepEqual(bids(), [[90, 2]]);
    assert.deepEqual(estimateMarketFills(board(), 2), {
        buy: { status: "estimated", averagePrice: 110, priceDifferencePercent: 0 },
        sell: { status: "estimated", averagePrice: 90, priceDifferencePercent: 0 },
    });
});

test("applies deltas and execution pruning in the same order live and in snapshot replay", () => {
    const {request, execute, update, asks} = setup();
    const initial = [{ price: 100, size: 1 }, { price: 110, size: 1 }];
    request()(initial);

    execute({ side: "BUY", price: 110 });
    assert.deepEqual(asks(), [[110, 1]]);
    update(100, 3);
    assert.deepEqual(asks(), [[100, 3], [110, 1]]);

    const respond = request();
    update(99, 2);
    execute({ side: "BUY", price: 110 });
    assert.deepEqual(asks(), [[110, 1]]);
    update(100, 3);
    const liveAsks = asks();
    respond(initial);
    assert.deepEqual(liveAsks, [[100, 3], [110, 1]]);
    assert.deepEqual(asks(), liveAsks);
});

test("discards an older response when snapshot requests overlap", () => {
    const {request, update, asks} = setup();
    const respondOlder = request();
    const respondNewer = request();

    update(100, 0);
    respondNewer([{ price: 100, size: 1 }, { price: 101, size: 1 }]);
    respondOlder([{ price: 100, size: 1 }]);

    assert.deepEqual(asks(), [[101, 1]]);
    request()([{ price: 100, size: 2 }]);
    assert.deepEqual(asks(), [[100, 2]]);
});

test("continues with realtime updates and later snapshots after a request fails", () => {
    const {responses$$, request, update, asks} = setup();
    const failed$ = Stream.create<Response>();
    responses$$.shamefullySendNext(failed$);
    failed$.shamefullySendError(new Error("Snapshot request failed"));

    update(100, 1);
    assert.deepEqual(asks(), [[100, 1]]);
    request()([{ price: 101, size: 2 }]);
    assert.deepEqual(asks(), [[101, 2]]);
});

test("keeps the last valid board and replays deltas after malformed snapshots", () => {
    const {request, update, asks} = setup();
    request()([{ price: 100, size: 1 }]);

    request()([], "upstream unavailable");
    request()([], JSON.stringify({ asks: [] }));
    request()([], JSON.stringify({ asks: [{ price: 102 }], bids: [] }));
    assert.deepEqual(asks(), [[100, 1]]);

    const respond = request();
    update(102, 3);
    respond([{ price: 101, size: 2 }, { price: 102, size: 1 }]);
    assert.deepEqual(asks(), [[101, 2], [102, 3]]);
});

const setup = () => {
    const updates$ = Stream.create<BoardLevels>();
    const responses$$ = Stream.create<Stream<Response>>();
    const executions$ = Stream.create<Execution[]>();
    let state = { board: new Board({ asks: [], bids: [] }) } as State;
    synchronizeBoard(updates$, responses$$, executions$, Stream.of(true)).addListener({
        next: (reduce) => { state = reduce(state) as State; },
    });

    return {
        board: () => state.board,
        asks: () => state.board.asks.map(({price, size}) => [price, size]),
        bids: () => state.board.bids.map(({price, size}) => [price, size]),
        execute: (...executions: Execution[]) => executions$.shamefullySendNext(executions),
        request: () => {
            const response$ = Stream.create<Response>();
            responses$$.shamefullySendNext(response$);
            return (asks: BoardOrder[], bids: BoardOrder[] | string = []) => {
                const text = typeof bids === "string" ? bids : JSON.stringify({ asks, bids });
                response$.shamefullySendNext({ text } as Response);
                response$.shamefullySendComplete();
            };
        },
        responses$$,
        sendDelta: (delta: BoardLevels) => updates$.shamefullySendNext(delta),
        update: (price: number, size: number) =>
            updates$.shamefullySendNext({ asks: [{ price, size }], bids: [] }),
    };
};
