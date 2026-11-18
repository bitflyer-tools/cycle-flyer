const assert = require('node:assert/strict');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: [
      'export { SocketIOSource } from "./src/drivers/socketIODriver";',
      'export { intent } from "./src/components/trade/board/intent";',
      'export { model } from "./src/components/trade/board/model";',
      'export { request } from "./src/components/trade/board/request";',
    ].join('\n'),
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  write: false,
});
const testModule = { exports: {} };
runInNewContext(outputFiles[0].text, { module: testModule, require, localStorage: { 'api-secret': 'test-secret' } });
const { SocketIOSource, intent, model, request } = testModule.exports;

const snapshotChannel = 'lightning_board_snapshot_FX_BTC_JPY';
const boardChannel = 'lightning_board_FX_BTC_JPY';
const executionChannel = 'lightning_executions_FX_BTC_JPY';

function makeSocket() {
  const handlers = new Map();
  const subscriptions = [];
  return {
    handlers,
    subscriptions,
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, channel) => {
      assert.equal(event, 'subscribe');
      subscriptions.push(channel);
    },
    receive: (event, message) => handlers.get(event)?.(message),
  };
}

test('subscribes only to board deltas and executions on connect and reconnect', () => {
  const socket = makeSocket();
  new SocketIOSource(socket);

  socket.receive('connect');
  assert.deepEqual(socket.subscriptions, [boardChannel, executionChannel]);

  socket.receive('connect');
  assert.deepEqual(socket.subscriptions, [boardChannel, executionChannel, boardChannel, executionChannel]);
  assert.equal(socket.handlers.has(snapshotChannel), false);
});

test('initializes the board from REST and applies WebSocket deltas', () => {
  const socket = makeSocket();
  const responses = Stream.create();
  const dom = { select: () => dom, events: () => Stream.never() };
  const actions = intent({
    socket: new SocketIOSource(socket),
    DOM: dom,
    HTTP: {
      select: (category) => {
        assert.equal(category, 'board');
        return responses;
      },
    },
    storage: { local: { getItem: () => Stream.never() } },
  });

  let state;
  const subscription = model(actions).subscribe({ next: (reduce) => { state = reduce(state); } });
  try {
    const requests = [];
    request().take(1).addListener({ next: (value) => requests.push(value) });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].category, 'board');
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, '/v1/getboard');
    assert.equal(url.searchParams.get('product_code'), 'FX_BTC_JPY');

    const snapshot = { asks: [{ price: 102, size: 1 }], bids: [{ price: 100, size: 2 }] };
    responses.shamefullySendNext(Stream.of({ text: JSON.stringify(snapshot) }));
    assert.equal(state.board.asks[0].size, 1);
    assert.equal(state.board.bids[0].size, 2);

    socket.receive(snapshotChannel, { asks: [], bids: [] });
    socket.receive(boardChannel, { asks: [{ price: 102, size: 3 }], bids: [] });
    assert.equal(state.board.asks[0].size, 3);
    assert.equal(state.board.bids[0].size, 2);
  } finally {
    subscription.unsubscribe();
  }
});
