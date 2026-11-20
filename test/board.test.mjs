import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';

const {outputFiles: [bundle]} = buildSync({
  entryPoints: ['src/models/board.ts'],
  bundle: true,
  format: 'esm',
  write: false,
});
const {Board} = await import(`data:text/javascript;base64,${Buffer.from(bundle.contents).toString('base64')}`);

const rows = (orders) => orders.map(({price, size}) => [price, size]);

test('keeps a single populated bucket on each side', () => {
  const board = new Board({
    asks: [{price: 250, size: 2}],
    bids: [{price: 150, size: 3}],
  });

  assert.deepEqual(rows(board.groupedAsks(100)), [[300, 2]]);
  assert.deepEqual(rows(board.groupedBids(100)), [[100, 3]]);
});

test('keeps both endpoint volumes and fills the gap on each side', () => {
  const board = new Board({
    asks: [{price: 350, size: 2}, {price: 550, size: 3}],
    bids: [{price: 350, size: 4}, {price: 150, size: 5}],
  });

  assert.deepEqual(rows(board.groupedAsks(100)), [[400, 2], [500, 0], [600, 3]]);
  assert.deepEqual(rows(board.groupedBids(100)), [[300, 4], [200, 0], [100, 5]]);
});

const level = (price, size) => ({price, size});

test("distant levels cap both grouped sides at 200 rows from their best price", () => {
    const board = new Board({
        asks: [level(20_000_000, 2), level(10_000_000, 1)],
        bids: [level(1_000_000, 2), level(9_999_900, 1)],
    });

    assert.deepEqual(rows(board.groupedAsks(100)), Array.from({length: 200}, (_, index) =>
        [10_000_000 + index * 100, index === 0 ? 1 : 0]));
    assert.deepEqual(rows(board.groupedBids(100)), Array.from({length: 200}, (_, index) =>
        [9_999_900 - index * 100, index === 0 ? 1 : 0]));
});

test("grouped sides sum rounded levels and fill gaps through the last occupied bucket", () => {
    const board = new Board({
        asks: [level(1_201, 4), level(1_010, 1), level(1_100, 2)],
        bids: [level(799, 4), level(999, 1), level(900, 2)],
    });

    assert.deepEqual(rows(board.groupedAsks(100)), [[1_100, 3], [1_200, 0], [1_300, 4]]);
    assert.deepEqual(rows(board.groupedBids(100)), [[900, 3], [800, 0], [700, 4]]);
    assert.deepEqual(rows(board.groupedAsks(10)), [[1_010, 1], [1_100, 2], [1_210, 4]]);
    assert.deepEqual(rows(board.groupedBids(10)), [[990, 1], [900, 2], [790, 4]]);
});

test("grouped sides handle empty books and a single occupied bucket", () => {
    const board = new Board({asks: [], bids: [level(999, 1), level(975, 2)]});

    assert.deepEqual(board.groupedAsks(100), []);
    assert.deepEqual(rows(board.groupedBids(100)), [[900, 3]]);
});

test("size 1 visits at most 201 levels per side and skips price gaps", () => {
    const asks = Array.from({length: 5_000}, (_, index) => level(20_000 + index * 2, index + 1));
    const bids = Array.from({length: 5_000}, (_, index) => level(15_000 - index * 2, index + 1));
    const board = new Board({asks: asks.slice().reverse(), bids: bids.slice().reverse()});

    for (const [orders, group, expected] of [
        [board.asks, () => board.groupedAsks(1), asks],
        [board.bids, () => board.groupedBids(1), bids],
    ]) {
        let priceReads = 0;
        orders.forEach((order) => {
            const price = order.price;
            Object.defineProperty(order, "price", {get: () => {
                priceReads++;
                return price;
            }});
        });

        assert.deepEqual(rows(group()), rows(expected.slice(0, 200)));
        assert.ok(priceReads <= 201, `Read ${priceReads} prices`);
    }
});

test("size 50 includes every level in the last visible bucket and skips gaps", () => {
    const asks = Array.from({length: 201}, (_, index) => level(30_000 + index * 100, 1));
    const bids = Array.from({length: 201}, (_, index) => level(25_000 - index * 100, 1));
    const board = new Board({asks: asks.slice().reverse(), bids: bids.slice().reverse()});
    board.merge([level(49_851, 2), level(49_875, 3), level(49_899, 4)],
        [level(5_149, 2), level(5_125, 3), level(5_101, 4)]);

    assert.deepEqual(rows(board.groupedAsks(50)), [...rows(asks.slice(0, 199)), [49_900, 10]]);
    assert.deepEqual(rows(board.groupedBids(50)), [...rows(bids.slice(0, 199)), [5_100, 10]]);
});
