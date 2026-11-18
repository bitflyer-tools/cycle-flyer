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

test('board deltas reuse the order form while order inputs still update it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const board$ = Stream.create();
  const execution$ = Stream.create();
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
    socket: { board$, execution$, childOrderEvent$: never(), parentOrderEvent$: never() },
    state: new StateSource(state$, 'state'),
    storage: { local: { getItem: never } },
  }, Stream.of(false));
  let state;
  let tradeNode;
  let orderNode;
  let orderRenders = 0;
  const requests = [];
  const requestListener = { next: (batch) => requests.push(...batch.requests) };
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
  sinks.orderRequests.addListener(requestListener);
  t.after(() => {
    sinks.orderRequests.removeListener(requestListener);
    sinks.DOM.removeListener(domListener);
    sinks.state.removeListener(stateListener);
  });

  execution$.shamefullySendNext({ side: 'BUY', price: 100000 });
  const initialRenders = orderRenders;
  const initialTrade = tradeNode;
  assert.ok(initialRenders > 0);

  for (let index = 0; index < 100; index++) {
    board$.shamefullySendNext({ asks: [{ price: 100001, size: index + 1 }], bids: [] });
  }
  assert.equal(state.boardComponentState.board.asks[0].size, 100);
  assert.notEqual(tradeNode, initialTrade);
  assert.equal(orderRenders, initialRenders);

  sizeInput$.shamefullySendNext({ target: { value: '0.1' } });
  assert.equal(orderRenders, initialRenders + 1);

  execution$.shamefullySendNext({ side: 'BUY', price: 100001 });
  assert.equal(orderRenders, initialRenders + 2);

  orders$.shamefullySendNext(Stream.of({ text: JSON.stringify([{ side: 'BUY', price: 99999, size: 0.1 }]) }));
  assert.equal(orderRenders, initialRenders + 3);

  marketBuy$.shamefullySendNext({});
  const orderRequest = requests.find(({ category }) => category === 'market-order');
  const { side, size } = JSON.parse(orderRequest.send);
  assert.deepEqual({ side, size }, { side: 'BUY', size: 0.1 });
});
