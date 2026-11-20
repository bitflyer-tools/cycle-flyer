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
      'export { BoardComponent } from "./src/components/trade/board";',
    ].join('\n'),
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  loader: { '.styl': 'empty' },
  external: ['socket.io-client', 'xstream'],
  define: { window: 'undefined' },
  platform: 'node',
  write: false,
});
const testModule = { exports: {} };
runInNewContext(outputFiles[0].text, {
  module: testModule,
  require,
  setTimeout,
  localStorage: { 'api-secret': 'test-secret' },
});
const { SocketIOSource, BoardComponent } = testModule.exports;

const snapshotChannel = 'lightning_board_snapshot_FX_BTC_JPY';
const boardChannel = 'lightning_board_FX_BTC_JPY';
const executionChannel = 'lightning_executions_FX_BTC_JPY';

function makeSocket() {
  const handlers = new Map();
  const subscriptions = [];
  return {
    connected: false,
    handlers,
    subscriptions,
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, channel) => {
      assert.equal(event, 'subscribe');
      subscriptions.push(channel);
    },
    receive(event, message) {
      if (event === 'connect' || event === 'disconnect') this.connected = event === 'connect';
      handlers.get(event)?.(message);
    },
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

test('synchronizes each connection with REST and rejects stale snapshots after disconnect', async () => {
  const socket = makeSocket();
  const responses = Stream.create();
  const dom = { select: () => dom, events: () => Stream.never() };
  const sinks = BoardComponent({
    socket: new SocketIOSource(socket),
    DOM: dom,
    state: { stream: Stream.never() },
    HTTP: {
      select: (category) => {
        assert.equal(category, 'board');
        return responses;
      },
    },
    storage: { local: { getItem: () => Stream.never() } },
  });

  let state;
  const requests = [];
  let requestResponse;
  const requestSubscription = sinks.HTTP.subscribe({
    next: (value) => {
      requests.push(value);
      requestResponse = Stream.create();
      responses.shamefullySendNext(requestResponse);
    },
  });
  const subscription = sinks.state.subscribe({ next: (reduce) => { state = reduce(state); } });
  try {
    assert.equal(requests.length, 0);
    socket.receive('connect');
    await Promise.resolve();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].category, 'board');
    assert.match(requests[0].url, /\/v1\/getboard$/);

    const snapshot = { asks: [{ price: 102, size: 1 }], bids: [{ price: 100, size: 2 }] };
    requestResponse.shamefullySendNext({ text: JSON.stringify(snapshot) });
    requestResponse.shamefullySendComplete();
    assert.equal(state.board.asks[0].size, 1);
    assert.equal(state.board.bids[0].size, 2);
    assert.equal(state.hasBoardSnapshot, true);

    socket.receive(snapshotChannel, { asks: [], bids: [] });
    socket.receive(boardChannel, { asks: [{ price: 102, size: 3 }], bids: [] });
    assert.equal(state.board.asks[0].size, 3);
    assert.equal(state.board.bids[0].size, 2);

    const refresh = Stream.create();
    responses.shamefullySendNext(refresh);
    socket.receive(boardChannel, { asks: [{ price: 102, size: 4 }], bids: [] });
    refresh.shamefullySendNext({ text: JSON.stringify(snapshot) });
    refresh.shamefullySendComplete();
    assert.equal(state.board.asks[0].size, 4);

    const stale = Stream.create();
    responses.shamefullySendNext(stale);
    socket.receive('disconnect');
    assert.equal(state.hasBoardSnapshot, false);

    responses.shamefullySendNext(Stream.of({ text: JSON.stringify(snapshot) }));
    assert.equal(state.hasBoardSnapshot, false);

    socket.receive('connect');
    await Promise.resolve();
    assert.equal(requests.length, 2);
    stale.shamefullySendNext({ text: JSON.stringify(snapshot) });
    assert.equal(state.hasBoardSnapshot, false);

    socket.receive(boardChannel, { asks: [{ price: 102, size: 5 }], bids: [] });
    assert.equal(state.hasBoardSnapshot, false);
    requestResponse.shamefullySendNext({ text: JSON.stringify(snapshot) });
    requestResponse.shamefullySendComplete();
    assert.equal(state.hasBoardSnapshot, true);
    assert.equal(state.board.asks[0].size, 5);
  } finally {
    requestSubscription.unsubscribe();
    subscription.unsubscribe();
  }
});
