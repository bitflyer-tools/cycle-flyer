import assert from "node:assert/strict";
import {test} from "node:test";
import {buildSync} from "esbuild";

const {outputFiles: [boardModule]} = buildSync({
    bundle: true,
    entryPoints: ["src/models/board.ts"],
    format: "esm",
    write: false,
});
const {Board} = await import(`data:text/javascript;base64,${Buffer.from(boardModule.contents).toString("base64")}`);

const level = (price, size) => ({price, size});
const rows = (orders) => orders.map(({price, size}) => level(price, size));

test("distant levels cap both grouped sides at 200 rows from their best price", () => {
    const board = new Board({
        asks: [level(20_000_000, 2), level(10_000_000, 1)],
        bids: [level(1_000_000, 2), level(9_999_900, 1)],
    });

    assert.deepEqual(rows(board.groupedAsks(100)), Array.from({length: 200}, (_, index) =>
        level(10_000_000 + index * 100, index === 0 ? 1 : 0)));
    assert.deepEqual(rows(board.groupedBids(100)), Array.from({length: 200}, (_, index) =>
        level(9_999_900 - index * 100, index === 0 ? 1 : 0)));
});

test("grouped sides sum rounded levels and fill gaps through the last occupied bucket", () => {
    const board = new Board({
        asks: [level(1_201, 4), level(1_010, 1), level(1_100, 2)],
        bids: [level(799, 4), level(999, 1), level(900, 2)],
    });

    assert.deepEqual(rows(board.groupedAsks(100)), [level(1_100, 3), level(1_200, 0), level(1_300, 4)]);
    assert.deepEqual(rows(board.groupedBids(100)), [level(900, 3), level(800, 0), level(700, 4)]);
    assert.deepEqual(rows(board.groupedAsks(10)), [level(1_010, 1), level(1_100, 2), level(1_210, 4)]);
    assert.deepEqual(rows(board.groupedBids(10)), [level(990, 1), level(900, 2), level(790, 4)]);
});

test("grouped sides handle empty books and a single occupied bucket", () => {
    const board = new Board({asks: [], bids: [level(999, 1), level(975, 2)]});

    assert.deepEqual(board.groupedAsks(100), []);
    assert.deepEqual(rows(board.groupedBids(100)), [level(900, 3)]);
});
