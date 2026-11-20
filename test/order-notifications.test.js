const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
globalThis.window = {};
const { mockDOMSource } = require('@cycle/dom');
delete globalThis.window;
const { StateSource } = require('@cycle/state');
const { buildSync } = require('esbuild');
const { default: Stream } = require('xstream');

const { outputFiles: [bundle] } = buildSync({
  stdin: {
    contents: "export { Trade } from './src/components/trade'; export * from './src/http';",
    resolveDir: require('node:path').join(__dirname, '..'),
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  loader: { '.styl': 'empty' },
  write: false,
});

const app = { exports: {} };
compileFunction(bundle.text, ['require', 'module', 'localStorage'])(
  require, app, { 'api-key': 'test', 'api-secret': 'test' },
);
const { Trade, limitOrder, marketOrder, stopOrder, twapSliceOrder } = app.exports;

function tradeHarness(t) {
  const responses = new Map();
  const select = (category) => {
    if (!responses.has(category)) responses.set(category, Stream.create());
    return responses.get(category);
  };
  const executionBatch$ = Stream.create();
  const childOrderEvent$ = Stream.create();
  const state$ = Stream.createWithMemory();
  const trade = Trade({
    DOM: mockDOMSource({}),
    HTTP: { select },
    orderRequests: { select: () => Stream.never() },
    socket: {
      board$: Stream.never(),
      execution$: Stream.never(),
      executionBatch$,
      childOrderEvent$,
      parentOrderEvent$: Stream.never(),
      reconnect$: Stream.never(),
    },
    state: new StateSource(state$, 'state'),
    storage: { local: { getItem: () => Stream.never() } },
  }, Stream.of(false));
  let state;
  const stateSubscription = trade.state.subscribe({
    next: (reducer) => {
      state = reducer(state);
      state$.shamefullySendNext(state);
    },
  });
  const sounds = [];
  const soundSubscription = trade.sound.subscribe({ next: (sound) => sounds.push(sound) });
  t.after(() => {
    soundSubscription.unsubscribe();
    stateSubscription.unsubscribe();
  });

  return {
    executionBatch$,
    childOrderEvent$,
    sounds,
    histories: () => state.histories,
    submit(input) {
      const request = { ...input, credentialVersion: 0 };
      const response$ = Stream.createWithMemory();
      response$.request = request;
      select(request.category).shamefullySendNext(response$);
      return {
        accept: () => {
          response$.shamefullySendNext({ request });
          response$.shamefullySendComplete();
        },
        reject: () => response$.shamefullySendError({ response: { request } }),
        disconnect: () => response$.shamefullySendError(new Error('Connection lost')),
      };
    },
  };
}

test('notifies for each other submission and private execution', (t) => {
  const trade = tradeHarness(t);
  trade.submit(marketOrder(0.01, 'BUY')).disconnect();
  trade.submit(limitOrder(100, 0.01, 'BUY')).accept();
  trade.submit(stopOrder(90, 0.01, 'SELL')).accept();
  trade.submit(twapSliceOrder(0.01, 'SELL', Symbol())).reject();
  trade.executionBatch$.shamefullySendNext([{ price: 100, size: 0.01, side: 'BUY' }]);
  trade.childOrderEvent$.shamefullySendNext({ event_type: 'ORDER' });

  const execution = { event_type: 'EXECUTION', side: 'BUY', price: 100, size: 0.01 };
  trade.childOrderEvent$.shamefullySendNext(execution);
  trade.childOrderEvent$.shamefullySendNext(execution);
  assert.deepEqual(trade.sounds, ['failure', 'success', 'success', 'failure', 'execution', 'execution']);
  assert.deepEqual(trade.histories().map(({ name }) => name), [
    'Executed', 'Executed', 'TWAP', 'Stop', 'Limit', 'Market',
  ]);
});
