const assert = require('node:assert/strict');
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
      'export { saveCredentials, currentCredentialVersion } from "./src/credentials";',
    ).join('\n'),
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  write: false,
});
const testModule = { exports: {} };
const localStorage = { getItem: () => null, removeItem() {} };
runInNewContext(outputFiles[0].text, { module: testModule, require, localStorage });
const components = testModule.exports;

const accountCategories = ['orders', 'parent-orders', 'positions'];
const otherAccountCategories = ['orders', 'positions'];
const initialCategories = [...accountCategories, 'collateral', 'status', 'board'];

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
      assert.equal(state, lastValidState);
      for (const value of invalid) {
        respond(JSON.stringify(value));
        assert.equal(state, lastValidState);
      }

      respond(JSON.stringify(next));
      assert.equal(read(state), expected[1]);
    } finally {
      subscription.unsubscribe();
    }
  });
}

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
