const assert = require('node:assert/strict');
const test = require('node:test');
const { StateSource } = require('@cycle/state');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const bundle = buildSync({
  entryPoints: ['src/components/trade/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['xstream'],
  banner: { js: 'const window = {}; const localStorage = { "api-secret": "test" };' },
  loader: { '.styl': 'empty' },
  write: false,
});
const tradeModule = { exports: {} };
new Function('require', 'module', bundle.outputFiles[0].text)(require, tradeModule);
const { Trade } = tradeModule.exports;

test('board deltas reuse the order form and refreshed markers show open quantities', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const board$ = Stream.create();
  const executionBatch$ = Stream.create();
  const sizeInput$ = Stream.create();
  const marketBuy$ = Stream.create();
  const orders$ = Stream.create();
  const state$ = Stream.createWithMemory();
  const never = () => Stream.never();
  const dom = {
    select: (selector) => ({
      '#size-input': { events: () => sizeInput$ },
      '.market-order-buttons': {
        select: (button) => ({ events: button === '.buy-button' ? () => marketBuy$ : never }),
      },
    })[selector] || dom,
    events: never,
  };
  const sinks = Trade({
    DOM: dom,
    HTTP: { select: (category) => category === 'orders' ? orders$ : never() },
    orderRequests: { select: never },
    socket: { board$, executionBatch$, childOrderEvent$: never(), parentOrderEvent$: never(), reconnect$: never() },
    state: new StateSource(state$, 'state'),
    storage: { local: { getItem: never } },
  }, Stream.of(false));
  let state;
  let tradeNode;
  let orderNode;
  let orderRenders = 0;
  const requests = [];
  const orderRequestListener = { next: (batch) => requests.push(...batch.requests) };
  const stateListener = { next: (reduce) => state$.shamefullySendNext(state = reduce(state)) };
  const domListener = {
    next: (node) => {
      tradeNode = node;
      const order = node.children[2];
      if (order !== orderNode) {
        orderNode = order;
        orderRenders++;
      }
    },
  };
  sinks.state.addListener(stateListener);
  sinks.DOM.addListener(domListener);
  sinks.orderRequests.addListener(orderRequestListener);
  t.after(() => {
    sinks.orderRequests.removeListener(orderRequestListener);
    sinks.DOM.removeListener(domListener);
    sinks.state.removeListener(stateListener);
  });

  executionBatch$.shamefullySendNext([{ side: 'BUY', price: 100000 }]);
  const initialRenders = orderRenders;
  const initialTrade = tradeNode;
  assert.ok(initialRenders > 0);

  t.mock.timers.tick(100);
  for (let index = 0; index < 100; index++) {
    board$.shamefullySendNext({
      asks: [{ price: 100001, size: index + 1 }],
      bids: [{ price: 99999, size: 1 }, { price: 99998, size: 1 }],
    });
  }
  assert.equal(state.boardComponentState.board.asks[0].size, 100);
  assert.notEqual(tradeNode, initialTrade);
  assert.equal(orderRenders, initialRenders);

  sizeInput$.shamefullySendNext({ target: { value: '0.1' } });
  assert.equal(orderRenders, initialRenders + 1);

  executionBatch$.shamefullySendNext([{ side: 'BUY', price: 100001 }]);
  assert.equal(orderRenders, initialRenders + 2);

  t.mock.timers.tick(100);
  orders$.shamefullySendNext(Stream.of({
    text: JSON.stringify([
      { side: 'BUY', price: 99999, size: 0.1, executed_size: 0.06, outstanding_size: 0.04 },
      { side: 'BUY', price: 99998, size: 0.2, executed_size: 0, outstanding_size: 0.2 },
    ]),
  }));
  assert.equal(orderRenders, initialRenders + 3);
  const bids = tradeNode.children[1].children.find(({ sel }) => sel === 'div.bids');
  const markers = bids.children.map((bid) => [
    bid.data.dataset.price,
    bid.children.find((node) => node?.sel === 'span.my-order')?.text,
  ]);
  assert.deepEqual(markers, [[99999, '0.04'], [99998, '0.2']]);

  marketBuy$.shamefullySendNext({});
  const orderRequest = requests.find(({ category }) => category === 'market-order');
  const { side, size } = JSON.parse(orderRequest.send);
  assert.deepEqual({ side, size }, { side: 'BUY', size: 0.1 });
});

test('the summary waits for a public execution before valuing an open position', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const executionBatch$ = Stream.create();
  const positions$ = Stream.create();
  const collateral$ = Stream.create();
  const state$ = Stream.createWithMemory();
  const never = () => Stream.never();
  const dom = { select: () => dom, events: never };
  const sinks = Trade({
    DOM: dom,
    HTTP: { select: (category) => ({ positions: positions$, collateral: collateral$ })[category] || never() },
    orderRequests: { select: never },
    socket: { board$: never(), executionBatch$, childOrderEvent$: never(), parentOrderEvent$: never(), reconnect$: never() },
    state: new StateSource(state$, 'state'),
    storage: { local: { getItem: never } },
  }, Stream.of(false));
  let state;
  let summary;
  const stateSubscription = sinks.state.subscribe({
    next: (reduce) => state$.shamefullySendNext(state = reduce(state)),
  });
  const domSubscription = sinks.DOM.subscribe({ next: (node) => { [summary] = node.children; } });
  t.after(() => {
    domSubscription.unsubscribe();
    stateSubscription.unsubscribe();
  });

  const value = (selector) => {
    const field = summary.children.find((node) => node.sel === selector).children[1];
    return [field.sel, field.text];
  };

  collateral$.shamefullySendNext(Stream.of({ text: JSON.stringify({ collateral: 2_000_000 }) }));
  positions$.shamefullySendNext(Stream.of({ text: JSON.stringify([{ side: 'BUY', price: 10_000_000, size: 0.1 }]) }));
  assert.deepEqual(value('div.current-price'), ['span.number', 'Pending']);
  assert.deepEqual(value('div.position'), ['span.number', (10_000_000).toLocaleString()]);
  assert.deepEqual(value('div.position-size'), ['span.number', '0.1']);
  assert.deepEqual(value('div.position-diff'), ['span.number', 'Pending']);
  assert.deepEqual(value('div.profit'), ['span.number', 'Pending']);
  assert.deepEqual(value('div.collateral'), ['span.number', (2_000_000).toLocaleString()]);

  executionBatch$.shamefullySendNext([{ side: 'BUY', price: 10_100_000 }]);
  assert.deepEqual(value('div.current-price'), ['span.number', (10_100_000).toLocaleString()]);
  assert.deepEqual(value('div.position-diff'), ['span.number.plus', (100_000).toLocaleString()]);
  assert.deepEqual(value('div.profit'), ['span.number.plus', (10_000).toLocaleString()]);
  assert.deepEqual(value('div.collateral'), ['span.number', (2_000_000).toLocaleString()]);
});
