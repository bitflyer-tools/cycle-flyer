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
      export { Board } from './models/board';
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
const { SocketIOSource, intent, model, Board } = bundledExports.exports;

function tradeWithBoard(board) {
  const handlers = new Map();
  const socket = new SocketIOSource({ on: (name, handler) => handlers.set(name, handler) });
  const actions = intent({ socket, HTTP: { select: () => Stream.never() } });
  let state;
  model(actions).addListener({ next: (reducer) => { state = reducer(state); } });
  state = { ...state, boardComponentState: { board } };
  return {
    socket,
    get state() { return state; },
    receive: handlers.get('lightning_executions_FX_BTC_JPY'),
  };
}

test('scans at most 1,000 asks for 50 buys at the best ask and leaves bids untouched', () => {
  const asks = Array.from({ length: 1000 }, (_, index) => ({ price: 100 + index, size: 1 }));
  const board = new Board({ asks, bids: [{ price: 99, size: 1 }] });
  const bids = board.bids;
  let priceReads = 0;
  board.asks.forEach((ask, index) => {
    Object.defineProperty(ask, 'price', { get: () => { priceReads++; return asks[index].price; } });
  });
  const trade = tradeWithBoard(board);

  trade.receive(Array.from({ length: 50 }, () => ({ side: 'BUY', price: 100 })));

  assert.ok(priceReads <= 1000, `Read ${priceReads} ask prices`);
  assert.equal(board.asks.length, 1000);
  assert.equal(board.bids, bids);
  assert.equal(trade.state.currentPrice, 100);
});

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
  const trade = tradeWithBoard(board);
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
