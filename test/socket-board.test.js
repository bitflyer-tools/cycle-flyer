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
      'export { authAckDeadlineMs, authRetryDelaysMs } from "./src/drivers/privateChannel";',
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
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  setInterval: (...args) => setInterval(...args),
  clearInterval: (...args) => clearInterval(...args),
  crypto: webcrypto,
  localStorage: { getItem: () => null, removeItem: () => {} },
});
const { SocketIOSource, BoardComponent, saveCredentials, authAckDeadlineMs, authRetryDelaysMs } = testModule.exports;

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

test('publishes only board deltas with finite prices and sizes on both sides', (t) => {
  const socket = makeSocket();
  const source = new SocketIOSource(socket);
  const received = [];
  const listener = source.board$.subscribe({ next: (delta) => received.push(delta) });
  t.after(() => listener.unsubscribe());

  [
    null,
    { bids: [] },
    { asks: {}, bids: [] },
    { asks: [null], bids: [] },
    { asks: [{ price: '102', size: 1 }], bids: [] },
    { asks: [], bids: [{ price: 100, size: Infinity }] },
  ].forEach((delta) => socket.receive(boardChannel, delta));

  const deletion = { asks: [], bids: [{ price: 100, size: 0 }] };
  socket.receive(boardChannel, deletion);
  assert.deepEqual(received, [deletion]);
});

test('delivers matching private order events from mixed and subsequent batches', async (t) => {
  await saveCredentials({ key: 'test-account', secret: 'test-secret' });
  t.after(() => saveCredentials(null));

  const socket = makeSocket();
  const subscribe = socket.emit;
  socket.emit = (event, value, done) => {
    if (event === 'auth') {
      done();
    } else {
      subscribe(event, value);
    }
  };
  const source = new SocketIOSource(socket);
  socket.receive('connect');
  await new Promise(setImmediate);

  [
    ['child_order_events', source.childOrderEvent$, 'child_order_id'],
    ['parent_order_events', source.parentOrderEvent$, 'parent_order_id'],
  ].forEach(([channel, stream, idField]) => {
    assert.ok(socket.subscriptions.includes(channel));
    const received = [];
    const listener = stream.subscribe({ next: (event) => received.push(event) });
    t.after(() => listener.unsubscribe());
    const matching = { [idField]: 'matching', event_type: 'ORDER', product_code: 'FX_BTC_JPY' };
    const withoutProduct = { [idField]: 'no-product', event_type: 'CANCEL' };
    const later = { ...matching, [idField]: 'later' };

    socket.receive(channel, matching);
    socket.receive(channel, null);
    assert.deepEqual(received, []);

    socket.receive(channel, [null, matching, 'invalid', [], { ...matching, product_code: 'BTC_JPY' }, withoutProduct]);
    assert.deepEqual(received, [matching, withoutProduct]);

    socket.receive(channel, [later]);
    assert.deepEqual(received, [matching, withoutProduct, later]);
  });
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

test('retries authentication once after a dropped acknowledgement, subscribing to private channels only once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await saveCredentials({ key: 'test-account', secret: 'test-secret' });
  t.after(() => saveCredentials(null));

  const socket = makeSocket();
  const subscribe = socket.emit;
  const authAcks = [];
  socket.emit = (event, value, done) => {
    if (event === 'auth') { authAcks.push(done); } else { subscribe(event, value); }
  };
  const source = new SocketIOSource(socket);
  const events = [];
  const listener = source.childOrderEvent$.subscribe({ next: (event) => events.push(event.id) });
  t.after(() => listener.unsubscribe());

  socket.receive('connect');
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 1);
  assert.deepEqual(socket.subscriptions, [boardChannel, executionChannel]);

  t.mock.timers.tick(authAckDeadlineMs);
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 1);

  t.mock.timers.tick(authRetryDelaysMs[0]);
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 2);

  authAcks[1]();
  await new Promise(setImmediate);
  assert.deepEqual(socket.subscriptions, [boardChannel, executionChannel, 'child_order_events', 'parent_order_events']);

  socket.receive('child_order_events', [{ id: 'after-retry' }]);
  assert.deepEqual(events, ['after-retry']);
});

test('retries authentication after the acknowledgement reports a transient error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await saveCredentials({ key: 'test-account', secret: 'test-secret' });
  t.after(() => saveCredentials(null));

  const socket = makeSocket();
  const subscribe = socket.emit;
  const authAcks = [];
  socket.emit = (event, value, done) => {
    if (event === 'auth') { authAcks.push(done); } else { subscribe(event, value); }
  };
  new SocketIOSource(socket);

  socket.receive('connect');
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 1);

  authAcks[0]({ message: 'temporary error' });
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 1);

  t.mock.timers.tick(authRetryDelaysMs[0]);
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 2);

  authAcks[1]();
  await new Promise(setImmediate);
  assert.deepEqual(socket.subscriptions, [boardChannel, executionChannel, 'child_order_events', 'parent_order_events']);
});

test('disconnecting cancels a pending authentication retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await saveCredentials({ key: 'test-account', secret: 'test-secret' });
  t.after(() => saveCredentials(null));

  const socket = makeSocket();
  const subscribe = socket.emit;
  const authAcks = [];
  socket.emit = (event, value, done) => {
    if (event === 'auth') { authAcks.push(done); } else { subscribe(event, value); }
  };
  new SocketIOSource(socket);

  socket.receive('connect');
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 1);

  socket.receive('disconnect');
  t.mock.timers.tick(authAckDeadlineMs + authRetryDelaysMs[0]);
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 1);
});

test('replacing credentials cancels a pending authentication retry for the old session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await saveCredentials({ key: 'account-a', secret: 'test-secret' });
  t.after(() => saveCredentials(null));

  const socket = makeSocket();
  socket.connected = true;
  socket.disconnect = () => socket;
  socket.connect = () => { socket.receive('connect'); return socket; };
  const subscribe = socket.emit;
  const authAcks = [];
  socket.emit = (event, value, done) => {
    if (event === 'auth') { authAcks.push({ key: value.api_key, done }); } else { subscribe(event, value); }
  };
  new SocketIOSource(socket);

  socket.receive('connect');
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 1);
  assert.equal(authAcks[0].key, 'account-a');

  await saveCredentials({ key: 'account-b', secret: 'test-secret' });
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 2);
  assert.equal(authAcks[1].key, 'account-b');
  authAcks[1].done();
  await new Promise(setImmediate);

  t.mock.timers.tick(authAckDeadlineMs + authRetryDelaysMs[0]);
  await new Promise(setImmediate);
  assert.equal(authAcks.length, 2);
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

    const beforeMalformed = state;
    const asks = state.board.asks;
    const bids = state.board.bids;
    const rejectedAsks = [{ price: 101, size: 9 }];
    [{ asks: rejectedAsks }, { asks: rejectedAsks, bids: null }].forEach((delta) => {
      socket.receive(boardChannel, delta);
      assert.equal(state, beforeMalformed);
      assert.equal(state.board.asks, asks);
      assert.equal(state.board.bids, bids);
      assert.equal(state.board.asks[0].price, 102);
      assert.equal(state.board.bids[0].price, 100);
    });

    socket.receive(executionChannel, [{ side: 'SELL', price: 99 }]);
    socket.receive(boardChannel, { asks: [{ price: 102, size: 4 }], bids: [] });
    assert.equal(state.board.asks[1].price, 103);
    assert.equal(state.board.asks[0].size, 4);
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
    const displayedBoard = state.board;

    stale.shamefullySendNext({ text: JSON.stringify(snapshot) });
    assert.equal(state.board, displayedBoard);
    assert.equal(state.hasBoardSnapshot, false);

    await Promise.resolve();
    assert.equal(requests.length, 4);
    t.mock.timers.tick(15000);
    assert.equal(requests.length, 5);
    const offlineResponse = requestResponse;

    socket.receive('connect');
    offlineResponse.shamefullySendNext({ text: JSON.stringify(snapshot) });
    assert.equal(state.board, displayedBoard);
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
