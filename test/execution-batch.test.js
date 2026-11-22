const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const { default: Stream } = require('xstream');

const bundle = buildSync({
  stdin: {
    contents: `
      export { SocketIOSource } from './drivers/socketIODriver';
      export { intent } from './components/trade/intent';
      export { model } from './components/trade/model';
      export { synchronizeBoard } from './components/trade/board/synchronizeBoard';
      export { Board } from './models/board';
      export { BoardSnapshot } from './models/boardSnapshot';
    `,
    resolveDir: require('node:path').join(__dirname, '../src'),
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  write: false,
}).outputFiles[0].text;
const bundledExports = { exports: {} };
new Function('require', 'module', bundle)(require, bundledExports);
const { SocketIOSource, intent, model, synchronizeBoard, Board, BoardSnapshot } = bundledExports.exports;

function setupSocket() {
  const handlers = new Map();
  const socket = new SocketIOSource({ connected: true, on: (name, handler) => handlers.set(name, handler) });
  return { socket, receive: handlers.get('lightning_executions_FX_BTC_JPY') };
}

function setupTrade(source) {
  const actions = intent({ socket: source.socket, HTTP: { select: () => Stream.never() } });
  let state;
  model(actions).addListener({ next: (reducer) => { state = reducer(state); } });
  return { ...source, get state() { return state; } };
}

function setupBoard(socket, board, responses = Stream.never()) {
  let state = { board };
  synchronizeBoard(socket.board$, responses, socket.executionBatch$, socket.connected$).addListener({
    next: (reduce) => { state = reduce(state); },
  });
  return () => state.board;
}

test('keeps both live side arrays and reads only the best quotes for executions at those prices', () => {
  const levels = {
    asks: Array.from({ length: 1000 }, (_, index) => ({ price: 1001 + index, size: 1 })),
    bids: Array.from({ length: 1000 }, (_, index) => ({ price: 1000 - index, size: 1 })),
  };
  const board = new Board(levels);
  const asks = board.asks;
  const bids = board.bids;
  let priceReads = 0;
  [...asks, ...bids].forEach((level) => {
    const { price } = level;
    Object.defineProperty(level, 'price', { get: () => { priceReads++; return price; } });
  });
  const trade = setupTrade(setupSocket());
  setupBoard(trade.socket, board);

  trade.receive(Array.from({ length: 50 }, () => [
    { side: 'BUY', price: 1001 }, { side: 'SELL', price: 1000 },
  ]).flat());

  assert.equal(priceReads, 2);
  assert.equal(board.asks, asks);
  assert.equal(board.bids, bids);
  assert.equal(trade.state.currentPrice, 1000);
});

const snapshotLevels = {
  asks: [{ price: 101, size: 1 }, { price: 102, size: 2 }],
  bids: [{ price: 99, size: 1 }, { price: 98, size: 2 }],
};

test('skips snapshot price traversal at the best quotes after deletions, insertions, and pruning', (t) => {
  const snapshot = new BoardSnapshot(snapshotLevels);
  const prune = (buy, sell) => snapshot.removeExecutions([
    { side: 'BUY', price: buy }, { side: 'SELL', price: sell },
  ]);
  const assertNoTraversal = (buy, sell) => {
    const visitPrices = t.mock.method(Map.prototype, 'forEach');
    try {
      prune(buy, sell);
    } finally {
      visitPrices.mock.restore();
    }
    assert.equal(visitPrices.mock.callCount(), 0);
  };

  assertNoTraversal(101, 99);
  snapshot.merge([{ price: 101, size: 0 }], [{ price: 99, size: 0 }]);
  assertNoTraversal(102, 98);

  snapshot.merge([{ price: 101, size: 3 }], [{ price: 99, size: 3 }]);
  assertNoTraversal(101, 99);
  prune(102, 98);
  assertNoTraversal(102, 98);
  assert.deepEqual(snapshot.toBoard(), new Board({
    asks: [snapshotLevels.asks[1]],
    bids: [snapshotLevels.bids[1]],
  }));

  prune(103, 97);
  assertNoTraversal(103, 97);
  assert.deepEqual(snapshot.toBoard(), new Board({ asks: [], bids: [] }));
});
const invalidExecutions = [
  { side: 'SELL', price: 0 },
  { side: 'SELL', price: -1 },
  { side: 'BUY', price: Infinity },
  { side: 'SELL', price: -Infinity },
  { side: 'BUY', price: NaN },
];

test('publishes only valid public executions and continues updating Trade', () => {
  const board = new Board(snapshotLevels);
  const trade = setupTrade(setupSocket());
  setupBoard(trade.socket, board);
  const batches = [];
  const executions = [];
  trade.socket.executionBatch$.addListener({ next: (batch) => batches.push(batch) });
  trade.socket.execution$.addListener({ next: (execution) => executions.push(execution) });

  const initialState = trade.state;
  const buy = { side: 'BUY', price: 102, id: 1 };
  [null, buy, 'invalid', [], [null], invalidExecutions].forEach(trade.receive);
  assert.equal(trade.state, initialState);
  assert.deepEqual(batches, []);
  assert.deepEqual(executions, []);

  const sell = { side: 'SELL', price: 98 };
  trade.receive([null, buy, {}, { price: 103 }, { side: 'UNKNOWN', price: 103 },
    { side: 'SELL', price: '97' }, sell, ...invalidExecutions]);
  assert.deepEqual(batches, [[buy, sell]]);
  assert.deepEqual(executions, [buy, sell]);
  assert.equal(trade.state.currentPrice, 98);
  assert.deepEqual(board, new Board({ asks: [snapshotLevels.asks[1]], bids: [snapshotLevels.bids[1]] }));

  const nextBuy = { side: 'BUY', price: 103 };
  const auction = { side: '', price: 100 };
  trade.receive([nextBuy, auction]);
  assert.deepEqual(batches, [[buy, sell], [nextBuy, auction]]);
  assert.deepEqual(executions, [buy, sell, nextBuy, auction]);
  assert.equal(trade.state.currentPrice, 100);
  assert.deepEqual(board, new Board({ asks: [], bids: [snapshotLevels.bids[1]] }));
});

test('keeps both sides unchanged for invalid executions during a delayed snapshot', () => {
  assertLiveAndReplayedBoard(invalidExecutions, snapshotLevels);
});

test('prunes both sides using only valid prices in a mixed batch during a delayed snapshot', () => {
  assertLiveAndReplayedBoard([
    { side: 'BUY', price: 102 },
    ...invalidExecutions,
    { side: 'SELL', price: 98 },
  ], {
    asks: [snapshotLevels.asks[1]],
    bids: [snapshotLevels.bids[1]],
  });
});

function assertLiveAndReplayedBoard(executions, expectedLevels) {
  const { socket, receive } = setupSocket();
  const responses = Stream.create();
  const response = Stream.create();
  const board = setupBoard(socket, new Board(snapshotLevels), responses);
  responses.shamefullySendNext(response);

  const expected = new Board(expectedLevels);
  receive(executions);
  const liveBoard = board();
  assert.deepEqual(liveBoard, expected);
  response.shamefullySendNext({ text: JSON.stringify(snapshotLevels) });
  assert.notEqual(board(), liveBoard);
  assert.deepEqual(board(), expected);
}

test('matches sequential pruning and delivers every execution in order', () => {
  const levels = {
    asks: [101, 102, 103, 104].map((price) => ({ price, size: 1 })),
    bids: [99, 98, 97, 96].map((price) => ({ price, size: 1 })),
  };
  const board = new Board(levels);
  const expected = new Board(levels);
  const executions = [
    { side: 'BUY', price: 103 },
    { side: 'SELL', price: 97 },
    { side: 'SELL', price: 98 },
    { side: 'BUY', price: 102 },
  ];
  executions.forEach(({ side, price }) => expected.remove(side, price));
  const trade = setupTrade(setupSocket());
  setupBoard(trade.socket, board);
  const individualExecutions = [];
  trade.socket.execution$.addListener({ next: (execution) => individualExecutions.push(execution) });

  trade.receive(executions);

  assert.deepEqual(board, expected);
  assert.deepEqual(individualExecutions, executions);
  assert.equal(trade.state.currentPrice, 102);

  const state = trade.state;
  trade.receive([]);
  assert.equal(trade.state, state);
  assert.deepEqual(individualExecutions, executions);
});
