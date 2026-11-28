const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: ['trade', 'summary'].flatMap((component) => {
      const directory = component === 'trade' ? 'trade' : `trade/${component}`;
      return ['intent', 'model', 'request'].map((name) =>
        `export { ${name} as ${component}_${name} } from "./src/components/${directory}/${name}";`);
    }).concat(
      'export { request as board_request } from "./src/components/trade/board/request";',
      'export { pollResponse } from "./src/components/trade/pollResponse";',
      'export { authorizeRequest, makeHTTPDriver, makeSignedHTTPDriver, unsignedRequests$ } from "./src/drivers/httpDriver";',
      'export { saveCredentials, currentCredentialVersion, initializeCredentials } from "./src/credentials";',
      'export { cancelOrders, getParentOrder, marketOrder, parentOrdersPageSize } from "./src/http";',
    ).join('\n'),
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  write: false,
});
const localStorage = { getItem: () => null, removeItem() {} };
const loadComponents = (overrides = {}) => {
  const module = { exports: {} };
  runInNewContext(outputFiles[0].text, { module, require, localStorage, ...overrides });
  return module.exports;
};
const components = loadComponents();

const accountCategories = ['orders', 'parent-orders', 'positions'];
const otherAccountCategories = ['orders', 'positions'];
const initialCategories = [...accountCategories, 'collateral', 'status', 'board'];

for (const stalledPage of ['first', 'continuation']) {
  test(`Trade recovers from stalled signing on the ${stalledPage} parent-order page`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const headers = { 'ACCESS-KEY': 'test-key' };
    const dispatched = [];
    let finishSigning;
    const renderer = loadComponents({
      setTimeout, clearTimeout, URL,
      window: { bitFlyerCredentials: {
        hasCredentials: async () => true,
        signRest: async (_method, path) => {
          const url = new URL(path, 'https://api.bitflyer.jp');
          const page = url.searchParams.has('before') ? 'continuation' : 'first';
          if (url.pathname === '/v1/me/getparentorders' && page === stalledPage && !finishSigning) {
            return new Promise((resolve) => { finishSigning = resolve; });
          }
          return headers;
        },
      } },
      require: (id) => id === '@cycle/http/lib/cjs/http-driver' ? {
        createResponse$: (request) => {
          const fullPage = stalledPage === 'continuation' && !dispatched.includes('parent-orders');
          dispatched.push(request.category);
          const orders = request.category !== 'parent-orders' ? []
            : fullPage ? Array.from({ length: renderer.parentOrdersPageSize }, (_, id) => ({ id, parent_order_id: `partial-${id}` }))
              : [{ parent_order_id: 'recovered' }];
          return Stream.fromPromise(Promise.resolve({ request, text: JSON.stringify(orders) }));
        },
        optionsToSuperagent: (request) => ({
          timeout() { return this; },
          end(callback) { callback(null, { request, text: '[]' }); },
        }),
      } : require(id),
    });
    await renderer.initializeCredentials();
    const requests$ = Stream.create();
    const HTTP = renderer.makeSignedHTTPDriver()(requests$);
    const idle = Stream.never();
    const actions = renderer.trade_intent({
      HTTP, socket: { childOrderEvent$: idle, executionBatch$: idle, parentOrderEvent$: idle, reconnect$: idle },
    });
    let state;
    const unsigned = [];
    const subscriptions = [
      renderer.trade_model(actions).subscribe({ next: (reduce) => { state = reduce(state); } }),
      renderer.unsignedRequests$.subscribe({ next: ({ category }) => unsigned.push(category) }),
      renderer.trade_request(actions).subscribe({ next: (request) => requests$.shamefullySendNext(request) }),
    ];
    t.after(() => subscriptions.forEach((subscription) => subscription.unsubscribe()));
    const lists = () => dispatched.filter((category) => category.startsWith('parent-orders'));

    await flush();
    assert.equal(typeof finishSigning, 'function');
    const beforeExpiry = stalledPage === 'first' ? [] : ['parent-orders'];
    t.mock.timers.tick(10000);
    await flush();
    t.mock.timers.tick(4999);
    await flush();
    assert.deepEqual(lists(), beforeExpiry);
    assert.deepEqual(unsigned, []);
    assert.deepEqual(Object.keys(state.parentStopOrders), []);

    t.mock.timers.tick(1);
    await flush();
    assert.deepEqual(unsigned, [stalledPage === 'first' ? 'parent-orders' : 'parent-orders-page']);
    assert.deepEqual(lists(), [...beforeExpiry, 'parent-orders']);
    assert.deepEqual(Object.keys(state.parentStopOrders), ['recovered']);

    finishSigning(headers);
    await flush();
    assert.deepEqual(lists(), [...beforeExpiry, 'parent-orders']);
    assert.deepEqual(Object.keys(state.parentStopOrders), ['recovered']);
  });
}

test('Other authenticated requests can finish signing after the parent-order list deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const headers = { 'ACCESS-KEY': 'test-key' };
  let finishSigning;
  const pendingSignature = new Promise((resolve) => { finishSigning = resolve; });
  const renderer = loadComponents({
    setTimeout, clearTimeout,
    window: { bitFlyerCredentials: {
      hasCredentials: async () => true,
      signRest: () => pendingSignature,
    } },
  });
  await renderer.initializeCredentials();
  const requests = [renderer.marketOrder(0.01, 'BUY'), renderer.cancelOrders(), renderer.getParentOrder('detail')];
  const authorized = Promise.all(requests.map(renderer.authorizeRequest));
  t.mock.timers.tick(15000);
  await new Promise((resolve) => setImmediate(resolve));
  finishSigning(headers);
  const results = await authorized;
  results.forEach((request, index) => {
    assert.equal(request.url, requests[index].url);
    assert.equal(request.headers['ACCESS-KEY'], headers['ACCESS-KEY']);
  });
});

for (const [key, secret] of [['', ''], ['key', ''], ['', 'secret'], ['key', 'secret']]) {
  test(`Trade polls with API key ${key ? 'present' : 'absent'} and secret ${secret ? 'present' : 'absent'}`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    await components.saveCredentials(key && secret ? { key, secret } : null);
    const reconnect$ = Stream.create();
    const connected$ = Stream.createWithMemory();
    connected$.shamefullySendNext(false);
    const parentOrders$ = Stream.create();
    const request = { credentialVersion: components.currentCredentialVersion() };
    const parentResponse$ = Object.assign(Stream.create(), { request });
    const idle = Stream.never();
    const actions = components.trade_intent({
      socket: { reconnect$, childOrderEvent$: idle, executionBatch$: idle, parentOrderEvent$: idle },
      HTTP: { select: (category) => category === 'parent-orders' ? parentOrders$ : idle },
    });
    const categories = [];
    const subscription = Stream.merge(
      components.trade_request(actions), components.summary_request(), components.board_request(connected$),
    ).subscribe({ next: (request) => categories.push(request.category) });
    t.after(() => subscription.unsubscribe());
    const takeCategories = () => categories.splice(0).sort();
    const authenticated = key && secret;

    await Promise.resolve();
    assert.deepEqual(takeCategories(), (authenticated ? [...initialCategories] : ['board', 'status']).sort());

    if (authenticated) {
      parentOrders$.shamefullySendNext(parentResponse$);
    }
    connected$.shamefullySendNext(true);
    reconnect$.shamefullySendNext(null);
    await Promise.resolve();
    assert.deepEqual(takeCategories(), ['board']);
    t.mock.timers.tick(500);
    assert.deepEqual(takeCategories(), authenticated ? otherAccountCategories : []);

    t.mock.timers.tick(9500);
    assert.deepEqual(takeCategories(), authenticated ? otherAccountCategories : []);
    t.mock.timers.tick(1000);
    parentResponse$.shamefullySendNext({ text: '[{"parent_order_id":"parent-id"}]' });
    parentResponse$.shamefullySendComplete();
    assert.deepEqual(takeCategories(), authenticated ? ['parent-order', 'parent-orders'] : []);

    t.mock.timers.tick(4000);
    assert.deepEqual(takeCategories(), authenticated ? ['board', 'collateral'] : ['board']);
    t.mock.timers.tick(15000);
    assert.deepEqual(takeCategories(), (authenticated
      ? ['board', 'collateral', 'status', ...otherAccountCategories, ...otherAccountCategories]
      : ['board', 'status']).sort());
  });
}

test('keeps active order markers after a failed or malformed poll and applies the next valid poll', () => {
  const responses = Stream.create();
  const idle = Stream.never();
  const actions = components.trade_intent({
    socket: { childOrderEvent$: idle, executionBatch$: idle, parentOrderEvent$: idle, reconnect$: idle },
    HTTP: { select: (category) => category === 'orders' ? responses : idle },
  });
  let state;
  const subscription = components.trade_model(actions).subscribe({
    next: (reduce) => { state = reduce(state); },
    error: (error) => { throw error; },
  });
  const respond = (orders) => responses.shamefullySendNext(Stream.of({ text: JSON.stringify(orders), request: { credentialVersion: components.currentCredentialVersion() } }));

  try {
    respond([{ side: 'BUY', price: 50000, size: 0.05, outstanding_size: 0.02 }]);
    assert.deepEqual(Array.from(state.orders, (order) => ({ ...order })), [
      { side: 'BUY', price: 50000, size: 0.02 },
    ]);
    const lastValidState = state;

    responses.shamefullySendNext(Stream.throw(new Error('Order poll failed')));
    assert.equal(state, lastValidState);

    respond([null]);
    assert.equal(state, lastValidState);

    respond([{ side: 'SELL', price: 51000, outstanding_size: 0.03 }]);
    assert.deepEqual(Array.from(state.orders, (order) => ({ ...order })), [
      { side: 'SELL', price: 51000, size: 0.03 },
    ]);

    respond([]);
    assert.equal(state.orders.length, 0);
  } finally {
    subscription.unsubscribe();
  }
});

const tests = [
  {
    component: 'trade', category: 'positions',
    first: [{ side: 'SELL', price: 100, size: 1 }],
    invalid: [null, [{ side: 'SELL', price: 100, size: '1' }]],
    next: [],
    read: (state) => state.position.size, expected: [-1, 0],
  },
  {
    component: 'summary', category: 'collateral',
    first: { collateral: 100 }, invalid: [{}, { collateral: '100' }],
    next: { collateral: 0 },
    read: (state) => state.collateral, expected: [100, 0],
  },
  {
    component: 'summary', category: 'status',
    first: { health: 'NORMAL', state: 'RUNNING' },
    invalid: [null, { health: 'NORMAL' }],
    next: { health: 'BUSY', state: 'RUNNING' },
    read: (state) => state.marketState.health, expected: ['NORMAL', 'BUSY'],
  },
];

for (const { component, category, first, invalid, next, read, expected } of tests) {
  test(`${category} keeps its last valid state and recovers on the next valid poll`, () => {
    const responses = Stream.create();
    const idle = Stream.never();
    const dom = { select: () => dom, events: () => idle };
    const actions = components[`${component}_intent`]({
      DOM: dom,
      storage: { local: { getItem: () => idle } },
      socket: { connected$: Stream.of(true), board$: idle, executionBatch$: idle, childOrderEvent$: idle, parentOrderEvent$: idle, reconnect$: idle },
      HTTP: { select: (name) => name === category ? responses : idle },
    });

    let state;
    const subscription = components[`${component}_model`](actions).subscribe({
      next: (reduce) => { state = reduce(state); },
      error: (error) => { throw error; },
    });
    const respond = (text, credentialVersion = components.currentCredentialVersion()) =>
      responses.shamefullySendNext(Stream.of({ text, request: { credentialVersion } }));

    try {
      respond(JSON.stringify(first));
      assert.equal(read(state), expected[0]);
      const lastValidState = state;

      if (category !== 'status') {
        respond(JSON.stringify(next), -1);
        assert.equal(state, lastValidState);
      }
      respond('upstream unavailable');
      // positions also marks positionStale on an unparsable response, so from here on only the
      // position itself (not the whole state reference) is guaranteed to stay unchanged.
      const assertUnaffected = () => category === 'positions'
        ? assert.equal(read(state), expected[0])
        : assert.equal(state, lastValidState);
      assertUnaffected();
      for (const value of invalid) {
        respond(JSON.stringify(value));
        assertUnaffected();
      }

      respond(JSON.stringify(next));
      assert.equal(read(state), expected[1]);
    } finally {
      subscription.unsubscribe();
    }
  });
}

test('marks the position snapshot stale after a failed refresh and fresh again after a valid one', () => {
  const responses = Stream.create();
  const idle = Stream.never();
  const actions = components.trade_intent({
    socket: { childOrderEvent$: idle, executionBatch$: idle, parentOrderEvent$: idle, reconnect$: idle },
    HTTP: { select: (category) => category === 'positions' ? responses : idle },
  });
  let state;
  const subscription = components.trade_model(actions).subscribe({
    next: (reduce) => { state = reduce(state); },
    error: (error) => { throw error; },
  });
  const respond = (text) => responses.shamefullySendNext(Stream.of({ text, request: { credentialVersion: components.currentCredentialVersion() } }));
  const failedPoll = (credentialVersion = components.currentCredentialVersion()) =>
    Object.assign(Stream.throw(new Error('Position poll failed')), { request: { credentialVersion } });

  try {
    respond(JSON.stringify([{ side: 'BUY', price: 100, size: 0.1 }]));
    assert.equal(state.positionStale, false);

    responses.shamefullySendNext(failedPoll());
    assert.equal(state.positionStale, true);

    respond(JSON.stringify([]));
    assert.equal(state.positionStale, false);
    assert.equal(state.position.size, 0);

    respond('not json');
    assert.equal(state.positionStale, true);

    respond(JSON.stringify([{ side: 'SELL', price: 100, size: 0.2 }]));
    assert.equal(state.positionStale, false);
    assert.equal(state.position.size, -0.2);
  } finally {
    subscription.unsubscribe();
  }
});

test('keeps the new position fresh when a poll from the previous credentials fails', async (t) => {
  const responses = Stream.create();
  const idle = Stream.never();
  const actions = components.trade_intent({
    socket: { childOrderEvent$: idle, executionBatch$: idle, parentOrderEvent$: idle, reconnect$: idle },
    HTTP: { select: (category) => category === 'positions' ? responses : idle },
  });
  let state;
  const subscription = components.trade_model(actions).subscribe({
    next: (reduce) => { state = reduce(state); },
    error: (error) => { throw error; },
  });
  t.after(() => subscription.unsubscribe());

  const oldRequest = { credentialVersion: components.currentCredentialVersion() };
  const oldResponse = Object.assign(Stream.create(), { request: oldRequest });
  responses.shamefullySendNext(oldResponse);
  await components.saveCredentials({ key: 'new-key', secret: 'new-secret' });

  const request = { credentialVersion: components.currentCredentialVersion() };
  responses.shamefullySendNext(Stream.of({ text: '[{"side":"BUY","price":100,"size":1}]', request }));
  assert.equal(state.position.size, 1);
  assert.equal(state.positionStale, false);
  const freshState = state;

  oldResponse.shamefullySendError(new Error('Position poll failed'));
  assert.equal(state, freshState);

  // Deliver another old response stream late so its sequence cannot mask the version check.
  const lateResponse = Object.assign(Stream.throw(new Error('Position poll failed')), { request: oldRequest });
  responses.shamefullySendNext(lateResponse);
  assert.equal(state, freshState);
});

const positionCloseId = Symbol('position close');
const accountPolls = [
  ['orders', 'onOrdersLoaded$', (price) => [{ price }], (orders) => orders[0].price],
  ['positions', 'onPositionsLoaded$',
    (price) => [{ side: 'BUY', price, size: 1 }], (result) => {
      assert.equal(result.positionCloseId, positionCloseId);
      return result.position.price;
    }],
];

for (const [category, action, payload, read] of accountPolls) {
  const observe = (t) => {
    const responses = Stream.create();
    const idle = Stream.never();
    const actions = components.trade_intent({
      socket: { executionBatch$: idle, childOrderEvent$: idle, parentOrderEvent$: idle, reconnect$: idle },
      HTTP: { select: (name) => name === category ? responses : idle },
    });
    const values = [];
    const subscription = actions[action].subscribe({ next: (value) => values.push(read(value)) });
    t.after(() => subscription.unsubscribe());

    const announce = (value, delay, credentialVersion = components.currentCredentialVersion()) => {
      const response = Stream.create();
      responses.shamefullySendNext(response);
      setTimeout(() => {
        response.shamefullySendNext({ text: JSON.stringify(payload(value)), request: { credentialVersion, positionCloseId } });
        response.shamefullySendComplete();
      }, delay);
    };

    t.mock.timers.enable({ apis: ['setTimeout'] });
    return { values, announce };
  };

  test(`${category} applies 11-second responses with a 10-second polling interval`, (t) => {
    const { values, announce } = observe(t);
    announce(1, 11000);
    t.mock.timers.tick(10000);
    announce(2, 11000);
    t.mock.timers.tick(1000);
    assert.deepEqual(values, [1]);

    t.mock.timers.tick(9000);
    announce(3, 11000);
    t.mock.timers.tick(1000);
    assert.deepEqual(values, [1, 2]);
  });

  test(`${category} ignores a newer response from stale credentials`, (t) => {
    const { values, announce } = observe(t);
    announce(1, 15000);
    announce(2, 1000, -1);
    t.mock.timers.tick(1000);
    assert.deepEqual(values, []);
    t.mock.timers.tick(14000);
    assert.deepEqual(values, [1]);
  });

  test(`${category} ignores older responses after applying a newer result`, (t) => {
    const { values, announce } = observe(t);
    announce(1, 15000);
    t.mock.timers.tick(10000);
    announce(2, 1000);
    t.mock.timers.tick(1000);
    assert.deepEqual(values, [2]);

    announce(3, 11000);
    t.mock.timers.tick(4000);
    assert.deepEqual(values, [2]);
    t.mock.timers.tick(7000);
    assert.deepEqual(values, [2, 3]);
  });
}

for (const category of ['orders', 'positions', 'collateral', 'status']) {
  test(`${category} transport bounds stalled polls and accepts delayed and recovery responses`, { timeout: 5000 }, async (t) => {
    const server = createServer();
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const requests = Stream.create();
    const responses = components.makeHTTPDriver()(requests).select(category);
    const failures = [];
    let outstanding = 0;
    const transport = responses.subscribe({ next: (response) => {
      outstanding++;
      response.addListener({
        error: (error) => { failures.push(error); outstanding--; },
        complete: () => { outstanding--; },
      });
    } });
    const values = [];
    const applied = Stream.create();
    const polls = components.pollResponse(responses, (value) => value).subscribe({ next: (value) => {
      values.push(value);
      applied.shamefullySendNext(value);
    } });
    t.after(() => { polls.unsubscribe(); transport.unsubscribe(); });

    const sendPoll = async () => {
      const incoming = once(server, 'request');
      requests.shamefullySendNext({ url: `http://127.0.0.1:${server.address().port}`, category, method: 'GET' });
      const [, response] = await incoming;
      return { response, closed: once(response, 'close') };
    };
    const succeed = async ({ response }, value) => {
      const next = new Promise((resolve) => applied.take(1).addListener({ next: resolve }));
      response.end(JSON.stringify(value));
      assert.equal(await next, value);
    };

    t.mock.timers.enable({ apis: ['setTimeout'] });
    const initial = await sendPoll();
    t.mock.timers.tick(10000);
    let stalled = await sendPoll();
    t.mock.timers.tick(1000);
    await succeed(initial, 1);
    t.mock.timers.tick(9000);

    for (let round = 1; round <= 3; round++) {
      const next = await sendPoll();
      assert.equal(outstanding, 2);
      t.mock.timers.tick(5000);
      await stalled.closed;
      assert.equal(stalled.response.writableFinished, false);
      assert.equal(failures.length, round);
      assert.equal(failures.at(-1).code, 'ECONNABORTED');
      assert.equal(outstanding, 1);
      stalled = next;
      t.mock.timers.tick(5000);
    }

    await succeed(await sendPoll(), 2);
    t.mock.timers.tick(5000);
    await stalled.closed;
    assert.equal(outstanding, 0);
    assert.deepEqual(values, [1, 2]);
  });
}
