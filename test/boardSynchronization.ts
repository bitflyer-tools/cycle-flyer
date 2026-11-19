import {Response} from "@cycle/http";
import {strict as assert} from "node:assert";
import {test} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/board";
import {synchronizeBoard} from "../src/components/trade/board/synchronizeBoard";
import {Board} from "../src/models/board";
import {BoardOrder} from "../src/models/boardOrder";
import {Execution} from "../src/models/execution";

test("replays realtime changes over a delayed snapshot", () => {
    const {request, update, asks} = setup();
    const respond = request();

    update(100, 0);
    update(102, 2);
    update(102, 3);
    respond([{ price: 100, size: 1 }, { price: 101, size: 4 }, { price: 102, size: 1 }]);

    assert.deepEqual(asks(), [[101, 4], [102, 3]]);
});

test("initializes from a fresh snapshot and applies subsequent realtime updates", () => {
    const {request, update, asks} = setup();
    request()([{ price: 100, size: 1 }]);
    assert.deepEqual(asks(), [[100, 1]]);

    update(100, 0);
    assert.deepEqual(asks(), []);
});

test("replays execution pruning on both sides of a delayed snapshot", () => {
    const {request, execute, asks, bids} = setup();
    const respond = request();

    execute({ side: "BUY", price: 110 }, { side: "SELL", price: 90 });
    respond(
        [{ price: 100, size: 1 }, { price: 110, size: 2 }],
        [{ price: 95, size: 1 }, { price: 90, size: 2 }],
    );

    assert.deepEqual(asks(), [[110, 2]]);
    assert.deepEqual(bids(), [[90, 2]]);
});

test("replays board deltas and execution batches in arrival order", () => {
    const {request, execute, update, asks} = setup();
    const respond = request();

    update(99, 2);
    execute({ side: "BUY", price: 110 });
    update(100, 3);
    respond([{ price: 100, size: 1 }, { price: 110, size: 1 }]);

    assert.deepEqual(asks(), [[100, 3], [110, 1]]);
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
    const updates$ = Stream.create<object>();
    const responses$$ = Stream.create<Stream<Response>>();
    const executions$ = Stream.create<Execution[]>();
    let state = { board: new Board({ asks: [], bids: [] }) } as State;
    synchronizeBoard(updates$, responses$$, executions$).addListener({
        next: (reduce) => { state = reduce(state) as State; },
    });

    return {
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
        update: (price: number, size: number) =>
            updates$.shamefullySendNext({ asks: [{ price, size }], bids: [] }),
    };
};
