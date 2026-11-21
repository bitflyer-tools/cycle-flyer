const { webcrypto } = require('node:crypto');
const credentials = { 'api-secret': 'test-secret' };
const assert = require('node:assert/strict');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: [
      'export { saveCredentials } from "./src/credentials";',
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
  setInterval: (...args) => setInterval(...args),
  clearInterval: (...args) => clearInterval(...args),
  crypto: webcrypto,
  localStorage: { getItem: () => null, removeItem: () => {} },
});
const { SocketIOSource, BoardComponent, saveCredentials } = testModule.exports;

const snapshotChannel = 'lightning_board_snapshot_FX_BTC_JPY';
const boardChannel = 'lightning_board_FX_BTC_JPY';
const executionChannel = 'lightning_executions_FX_BTC_JPY';

function makeSocket() {
  const handlers = new Map();
  const subscriptions = [];
  return {
    connected: false,
    handlers,
    disconnect() { return this; },
    connect() { return this; },
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

test('ignores events from the previous account until the new socket authenticates', async (t) => {
  await saveCredentials({ key: 'account-a', secret: 'test-secret' });

  const socket = makeSocket();
  const authentications = [];
  const subscribe = socket.emit;
  socket.connected = true;
  socket.disconnect = () => socket;
  socket.connect = () => { socket.receive('connect'); return socket; };
  socket.emit = (event, value, done) => {
    if (event === 'auth') {
      authentications.push({ key: value.api_key, done });
    } else {
      subscribe(event, value);
    }
  };

  const source = new SocketIOSource(socket);
  const events = [];
  const listener = source.childOrderEvent$.subscribe({ next: (event) => events.push(event.id) });
  t.after(() => listener.unsubscribe());
  const receive = (id) => socket.receive('child_order_events', [{ id }]);

  socket.receive('connect');
  await new Promise(setImmediate);
  authentications[0].done();
  receive('a');
  const saving = saveCredentials({ key: 'account-b', secret: 'test-secret' });
  receive('late-a');
  await saving;
  await new Promise(setImmediate);
  authentications[0].done();
  receive('before-b-auth');
  authentications[1].done();
  receive('b');

  assert.deepEqual(authentications.map(({ key }) => key), ['account-a', 'account-b']);
  assert.deepEqual(events, ['a', 'b']);
});

test('polls REST offline and synchronizes previews only from a fresh connected snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
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
    await Promise.resolve();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].category, 'board');
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, '/v1/getboard');
    assert.equal(url.searchParams.get('product_code'), 'FX_BTC_JPY');

    const snapshot = {
      asks: [{ price: 102, size: 1 }, { price: 103, size: 2 }],
      bids: [{ price: 100, size: 2 }],
    };
    requestResponse.shamefullySendNext({ text: JSON.stringify(snapshot) });
    requestResponse.shamefullySendComplete();
    assert.equal(state.board.asks[0].size, 1);
    assert.equal(state.board.bids[0].size, 2);
    assert.equal(state.hasBoardSnapshot, false);

    t.mock.timers.tick(15000);
    assert.equal(requests.length, 2);
    requestResponse.shamefullySendNext({ text: JSON.stringify({ ...snapshot, asks: [] }) });
    requestResponse.shamefullySendComplete();
    assert.equal(state.board.asks.length, 0);
    assert.equal(state.hasBoardSnapshot, false);

    socket.receive('connect');
    await Promise.resolve();
    assert.equal(requests.length, 3);
    requestResponse.shamefullySendNext({ text: JSON.stringify(snapshot) });
    requestResponse.shamefullySendComplete();
    assert.equal(state.hasBoardSnapshot, true);

    socket.receive(snapshotChannel, { asks: [], bids: [] });
    socket.receive(boardChannel, { asks: [{ price: 102, size: 3 }], bids: [] });
    assert.equal(state.board.asks[0].size, 3);
    assert.equal(state.board.bids[0].size, 2);

    const refresh = Stream.create();
    responses.shamefullySendNext(refresh);
    socket.receive(executionChannel, [{ side: 'SELL', price: 99 }]);
    socket.receive(boardChannel, { asks: [{ price: 102, size: 4 }], bids: [] });
    assert.equal(state.board.asks[1].price, 103);
    refresh.shamefullySendNext({ text: JSON.stringify({ ...snapshot, asks: [snapshot.asks[0]] }) });
    refresh.shamefullySendComplete();
    assert.equal(state.board.asks.length, 1);
    assert.equal(state.board.asks[0].price, 102);
    assert.equal(state.board.asks[0].size, 4);
    assert.equal(state.board.bids.length, 0);
    assert.equal(state.hasBoardSnapshot, true);

    const stale = Stream.create();
    responses.shamefullySendNext(stale);
    socket.receive(executionChannel, [{ side: 'BUY', price: 103 }]);
    socket.receive('disconnect');
    assert.equal(state.hasBoardSnapshot, false);

    stale.shamefullySendNext({ text: JSON.stringify(snapshot) });
    assert.equal(state.board.asks[0].size, 1);
    assert.equal(state.hasBoardSnapshot, false);

    await Promise.resolve();
    assert.equal(requests.length, 4);
    t.mock.timers.tick(15000);
    assert.equal(requests.length, 5);
    const offlineResponse = requestResponse;

    socket.receive('connect');
    offlineResponse.shamefullySendNext({ text: JSON.stringify(snapshot) });
    assert.equal(state.hasBoardSnapshot, false);
    await Promise.resolve();
    assert.equal(requests.length, 6);
    assert.equal(requests[5].url, requests[0].url);
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
