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
  define: { window: 'undefined' },
  loader: { '.styl': 'empty' },
  write: false,
});
const tradeModule = { exports: {} };
new Function('require', 'module', bundle.outputFiles[0].text)(require, tradeModule);
const { Trade } = tradeModule.exports;

test('board deltas reuse the order form and refreshed markers show open quantities', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
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
  t.mock.timers.tick(100);
  assert.notEqual(tradeNode, initialTrade);
  assert.equal(orderRenders, initialRenders);

  sizeInput$.shamefullySendNext({ target: { value: '0.1' } });
  assert.equal(orderRenders, initialRenders + 1);

  executionBatch$.shamefullySendNext([{ side: 'BUY', price: 100001 }]);
  assert.equal(orderRenders, initialRenders + 2);

  t.mock.timers.tick(100);
  orders$.shamefullySendNext(Stream.of({
    request: { credentialVersion: 0 },
    text: JSON.stringify([
      { side: 'BUY', price: 99999, size: 0.1, executed_size: 0.06, outstanding_size: 0.04 },
      { side: 'BUY', price: 99998, size: 0.2, executed_size: 0, outstanding_size: 0.2 },
    ]),
  }));
  assert.equal(orderRenders, initialRenders + 3);
  t.mock.timers.tick(100);
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
  t.mock.timers.enable({ apis: ['setTimeout'] });
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
  const domSubscription = sinks.DOM.subscribe({
    next: (node) => {
      const sidebar = node.children.find(({ sel }) => sel === 'div.trade-sidebar');
      summary = sidebar.children.find(({ sel }) => sel === 'div.summary');
    },
  });
  t.after(() => {
    domSubscription.unsubscribe();
    stateSubscription.unsubscribe();
  });

  const value = (selector) => {
    const field = summary.children.find((node) => node.sel === selector).children[1];
    return [field.sel, field.text];
  };

  collateral$.shamefullySendNext(Stream.of({ request: { credentialVersion: 0 }, text: JSON.stringify({ collateral: 2_000_000 }) }));
  positions$.shamefullySendNext(Stream.of({ request: { credentialVersion: 0 }, text: JSON.stringify([{ side: 'BUY', price: 10_000_000, size: 0.1 }]) }));
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

test('recent market trades seed and refresh without credentials or extra board renders', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const executionBatch$ = Stream.create();
  const reconnect$ = Stream.create();
  const history$ = Stream.create();
  const state$ = Stream.createWithMemory();
  const never = () => Stream.never();
  const dom = { select: () => dom, events: never };
  const sinks = Trade({
    DOM: dom,
    HTTP: { select: (category) => category === 'recent-trades' ? history$ : never() },
    orderRequests: { select: never },
    socket: { board$: never(), executionBatch$, childOrderEvent$: never(), parentOrderEvent$: never(), reconnect$ },
    state: new StateSource(state$, 'state'),
    storage: { local: { getItem: never } },
  }, Stream.of(false));
  let state;
  let board;
  let panel;
  let panelRenders = 0;
  const requests = [];
  const stateSub = sinks.state.subscribe({ next: (reduce) => state$.shamefullySendNext(state = reduce(state)) });
  const domSub = sinks.DOM.subscribe({ next: ({ children }) => {
    board = children[1];
    if (children[3] !== panel) {
      panel = children[3];
      panelRenders++;
    }
  } });
  const httpSub = sinks.HTTP.subscribe({ next: (request) => {
    if (request?.category === 'recent-trades') requests.push(request);
  } });
  t.after(() => {
    httpSub.unsubscribe();
    domSub.unsubscribe();
    stateSub.unsubscribe();
    t.mock.timers.tick(100);
  });

  assert.equal(panel.children[0].text, 'Recent Trades');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, 'https://api.bitflyer.jp/v1/executions?product_code=FX_BTC_JPY&count=25');

  const trade = (id, options = {}) =>
    ({ id, side: 'BUY', price: 100000, size: 0.01, exec_date: '2026-11-21T09:57:40.397', ...options });
  const respond = (rows) => history$.shamefullySendNext(Stream.of({ text: JSON.stringify(rows) }));
  const displayed = () => panel.children[1].children[0].children[1].children;
  const ids = () => displayed().map((row) => row.key);

  executionBatch$.shamefullySendNext([trade(3)]);
  respond([trade(2, { side: '' }), trade(3), trade(1, { exec_date: 'invalid' }), null]);
  assert.equal(panelRenders, 1);
  t.mock.timers.tick(100);
  assert.equal(panelRenders, 2);
  assert.deepEqual(ids(), [3, 2]);
  assert.equal(displayed()[0].children[0].children[0].text, '09:57:40.397');
  assert.equal(displayed()[0].children[1].text, 'BUY');
  assert.equal(displayed()[0].children[2].text, (100000).toLocaleString());
  assert.equal(displayed()[0].children[3].text, '0.01');
  assert.equal(displayed()[1].children[1].text, '—');

  const previousBoard = board;
  reconnect$.shamefullySendNext(null);
  assert.equal(requests.length, 2);
  history$.shamefullySendNext(Stream.throw(new Error('Public executions unavailable')));
  respond([trade(5), trade(4), trade(3)]);
  t.mock.timers.tick(100);
  assert.deepEqual(ids(), [5, 4, 3, 2]);
  assert.equal(board, previousBoard);

  const rendersBeforeBurst = panelRenders;
  Array.from({ length: 30 }, (_, index) => trade(index + 6)).forEach((execution) =>
    executionBatch$.shamefullySendNext([execution]));
  assert.equal(panelRenders, rendersBeforeBurst);
  t.mock.timers.tick(100);
  assert.equal(panelRenders, rendersBeforeBurst + 1);
  assert.deepEqual(ids(), Array.from({ length: 25 }, (_, index) => 35 - index));
});
