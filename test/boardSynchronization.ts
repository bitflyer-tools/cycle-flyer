import {Response} from "@cycle/http";
import {strict as assert} from "node:assert";
import {test} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/board";
import {synchronizeBoard} from "../src/components/trade/board/synchronizeBoard";
import {Board, BoardLevels} from "../src/models/board";

test("replays realtime changes over a delayed snapshot", () => {
    const {request, update, asks} = setup();
    const respond = request();

    update(100, 0);
    update(102, 2);
    update(102, 3);
    respond([{ price: 100, size: 1 }, { price: 101, size: 4 }, { price: 102, size: 1 }]);

    assert.deepEqual(asks(), [[101, 4], [102, 3]]);
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
    let state = { board: new Board({ asks: [], bids: [] }) } as State;
    synchronizeBoard(updates$, responses$$, Stream.of(true)).addListener({
        next: (reduce) => { state = reduce(state) as State; },
    });

    return {
        board: () => state.board,
        asks: () => state.board.asks.map(({price, size}) => [price, size]),
        request: () => {
            const response$ = Stream.create<Response>();
            responses$$.shamefullySendNext(response$);
            return (asks: Array<{price: number; size: number}>, text = JSON.stringify({ asks, bids: [] })) => {
                response$.shamefullySendNext({ text } as Response);
                response$.shamefullySendComplete();
            };
        },
        responses$$,
        update: (price: number, size: number) =>
            updates$.shamefullySendNext({ asks: [{ price, size }], bids: [] }),
    };
};
