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
    contents: "export { Root } from './src/components'; export * from './src/http'; export { makeNotificationDriver } from './src/drivers/notificationDriver';",
    resolveDir: require('node:path').join(__dirname, '..'),
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  loader: { '.styl': 'empty' },
  write: false,
});

function appHarness(t) {
  const notifications = [];
  class Notification {
    static permission = 'granted';
    constructor(title) { notifications.push(title); }
  }
  const module = { exports: {} };
  compileFunction(bundle.text, ['require', 'module', 'localStorage', 'Notification'])(
    require, module, { 'api-key': 'test', 'api-secret': 'test', 'notifications-enabled': 'true' }, Notification,
  );
  const { Root, makeNotificationDriver, ...orders } = module.exports;
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
      connected$: Stream.of(true),
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
  const notification$ = Stream.create();
  makeNotificationDriver()(notification$);
  const notificationSubscription = app.notification.subscribe({
    next: (event) => notification$.shamefullySendNext(event),
  });
  t.after(() => {
    soundSubscription.unsubscribe();
    notificationSubscription.unsubscribe();
    stateSubscription.unsubscribe();
  });

  return {
    executionBatch$,
    childOrderEvent$,
    notifications,
    orders,
    sounds,
    histories: () => state.trade.histories,
    submit(input) {
      const request = { ...input, credentialVersion: 0 };
      const response$ = Stream.createWithMemory();
      response$.request = request;
      select(request.category).shamefullySendNext(response$);
      return {
        accept: (body) => {
          response$.shamefullySendNext({ request, status: 200, text: JSON.stringify(body) });
          response$.shamefullySendComplete();
        },
        reject: () => response$.shamefullySendError({ response: { request } }),
        timeOut: () => response$.shamefullySendError({ code: 'ECONNABORTED', errno: 'ETIME' }),
      };
    },
  };
}

test('desktop notifications distinguish order outcomes from private executions', (t) => {
  const app = appHarness(t);
  const { cancelOrders, cancelParentOrder, limitOrder, marketOrder, stopOrder, twapSliceOrder } = app.orders;
  app.submit(marketOrder(0.01, 'BUY')).timeOut();
  app.submit(limitOrder(100, 0.01, 'BUY')).accept({ child_order_acceptance_id: 'JRF-child' });
  app.submit(stopOrder(90, 0.01, 'SELL')).accept({ parent_order_acceptance_id: 'JRF-parent' });
  app.submit(twapSliceOrder(0.01, 'SELL', Symbol())).reject();
  app.submit(cancelOrders()).accept({});
  app.submit(cancelParentOrder('JRF-parent')).reject();
  app.submit(cancelOrders()).timeOut();
  app.executionBatch$.shamefullySendNext([{ price: 100, size: 0.01, side: 'BUY' }]);
  app.childOrderEvent$.shamefullySendNext({ event_type: 'ORDER' });

  const outcomeTitles = [
    'Order unconfirmed', 'Order accepted', 'Order accepted', 'Order rejected',
    'Cancellation confirmed', 'Cancellation rejected', 'Cancellation unconfirmed',
  ];
  assert.deepEqual(app.notifications, outcomeTitles);

  const execution = { event_type: 'EXECUTION', side: 'BUY', price: 100, size: 0.01 };
  app.childOrderEvent$.shamefullySendNext(execution);
  app.childOrderEvent$.shamefullySendNext(execution);
  assert.deepEqual(app.sounds, [
    'failure', 'success', 'success', 'failure', 'success', 'failure', 'failure', 'execution', 'execution',
  ]);
  assert.deepEqual(app.notifications, [...outcomeTitles, 'Execution', 'Execution']);
  assert.deepEqual(app.histories().map(({ name }) => name), [
    'Executed', 'Executed', 'Cancel', 'Cancel', 'Cancel', 'TWAP', 'Stop', 'Limit', 'Market',
  ]);
  assert.equal(app.histories().at(-1).status, 'unconfirmed');
  assert.equal(app.histories().at(-1).timedOut, true);
});
