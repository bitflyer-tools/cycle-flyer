const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
globalThis.window = {};
const { mockDOMSource } = require('@cycle/dom');
delete globalThis.window;
const { StateSource } = require('@cycle/state');
const { routerify } = require('cyclic-router');
const switchPath = require('switch-path').default;
const { buildSync } = require('esbuild');
const { default: Stream } = require('xstream');

const { outputFiles: [bundle] } = buildSync({
  stdin: {
    contents: "export { Root } from './src/components'; export * from './src/http';",
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
const { Root, limitOrder, marketOrder, stopOrder, twapSliceOrder } = app.exports;

function appHarness(t) {
  const responses = new Map();
  const select = (category) => {
    if (!responses.has(category)) responses.set(category, Stream.create());
    return responses.get(category);
  };
  const executionBatch$ = Stream.create();
  const childOrderEvent$ = Stream.create();
  const state$ = Stream.createWithMemory();
  const app = routerify(Root, switchPath)({
    DOM: mockDOMSource({}),
    HTTP: { select },
    history: Stream.of({ pathname: '/' }),
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
  });
  let state;
  const stateSubscription = app.state.subscribe({
    next: (reducer) => {
      state = reducer(state);
      state$.shamefullySendNext(state);
    },
  });
  const sounds = [];
  const soundSubscription = app.sound.subscribe({ next: (sound) => sounds.push(sound) });
  t.after(() => {
    soundSubscription.unsubscribe();
    stateSubscription.unsubscribe();
  });

  return {
    executionBatch$,
    childOrderEvent$,
    sounds,
    histories: () => state.trade.histories,
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

test('notifies for submissions, TWAP slices, and private executions', (t) => {
  const app = appHarness(t);
  app.submit(marketOrder(0.01, 'BUY')).disconnect();
  app.submit(limitOrder(100, 0.01, 'BUY')).accept();
  app.submit(stopOrder(90, 0.01, 'SELL')).accept();
  app.submit(twapSliceOrder(0.01, 'SELL', Symbol())).reject();
  app.executionBatch$.shamefullySendNext([{ price: 100, size: 0.01, side: 'BUY' }]);
  app.childOrderEvent$.shamefullySendNext({ event_type: 'ORDER' });

  const execution = { event_type: 'EXECUTION', side: 'BUY', price: 100, size: 0.01 };
  app.childOrderEvent$.shamefullySendNext(execution);
  app.childOrderEvent$.shamefullySendNext(execution);
  assert.deepEqual(app.sounds, ['failure', 'success', 'success', 'failure', 'execution', 'execution']);
  assert.deepEqual(app.histories().map(({ name }) => name), [
    'Executed', 'Executed', 'TWAP', 'Stop', 'Limit', 'Market',
  ]);
});
