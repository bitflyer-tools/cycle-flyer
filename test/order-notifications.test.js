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
const { Trade, ifdocoOrder, limitOrder, marketOrder, stopOrder, twapSliceOrder } = app.exports;

function tradeHarness(t) {
  const responses = new Map();
  const select = (category) => {
    if (!responses.has(category)) responses.set(category, Stream.create());
    return responses.get(category);
  };
  const execution$ = Stream.create();
  const childOrderEvent$ = Stream.create();
  const state$ = Stream.createWithMemory();
  const trade = Trade({
    DOM: mockDOMSource({}),
    HTTP: { select },
    socket: { board$: Stream.never(), execution$, childOrderEvent$, parentOrderEvent$: Stream.never() },
    state: new StateSource(state$, 'state'),
    storage: { local: { getItem: () => Stream.never() } },
  });
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
    execution$,
    childOrderEvent$,
    sounds,
    histories: () => state.histories,
    submit(request) {
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

test('notifies once per overlapping IFDOCO outcome and records all three legs', (t) => {
  const trade = tradeHarness(t);
  const rejected = trade.submit(ifdocoOrder(110, 90, 0.01, 'BUY'));
  const accepted = trade.submit(ifdocoOrder(120, 80, 0.02, 'BUY'));
  assert.deepEqual(trade.sounds, []);

  accepted.accept();
  assert.deepEqual(trade.sounds, ['success']);
  assert.deepEqual(trade.histories().map(({ name, status }) => [name, status]), [
    ['Stop', 'success'], ['Limit', 'success'], ['Market', 'success'],
  ]);

  rejected.reject();
  assert.deepEqual(trade.sounds, ['success', 'failure']);
  assert.deepEqual(trade.histories().map(({ name, status }) => [name, status]), [
    ['Stop', 'failed'], ['Limit', 'failed'], ['Market', 'failed'],
    ['Stop', 'success'], ['Limit', 'success'], ['Market', 'success'],
  ]);
});

test('notifies for each other submission and private execution', (t) => {
  const trade = tradeHarness(t);
  trade.submit(marketOrder(0.01, 'BUY')).disconnect();
  trade.submit(limitOrder(100, 0.01, 'BUY')).accept();
  trade.submit(stopOrder(90, 0.01, 'SELL')).accept();
  trade.submit(twapSliceOrder(0.01, 'SELL')).reject();
  trade.execution$.shamefullySendNext({ price: 100 });
  trade.childOrderEvent$.shamefullySendNext({ event_type: 'ORDER' });

  const execution = { event_type: 'EXECUTION', side: 'BUY', price: 100, size: 0.01 };
  trade.childOrderEvent$.shamefullySendNext(execution);
  trade.childOrderEvent$.shamefullySendNext(execution);
  assert.deepEqual(trade.sounds, ['failure', 'success', 'success', 'failure', 'execution', 'execution']);
  assert.deepEqual(trade.histories().map(({ name }) => name), [
    'Executed', 'Executed', 'TWAP', 'Stop', 'Limit', 'Market',
  ]);
});
