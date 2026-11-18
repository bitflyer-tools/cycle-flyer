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
