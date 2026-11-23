const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: [
      'export { saveCredentials } from "./src/credentials";',
      'export { allocateSlices, canStart, defaultTwapOrder } from "./src/models/twapOrder";',
      'export { twapIntent } from "./src/components/trade/order/twapIntent";',
      'export { twapModel } from "./src/components/trade/order/twapModel";',
      'export { twapSection } from "./src/components/trade/order/twapView";',
      'export { twapRequest } from "./src/components/trade/order/twapRequest";',
    ].join('\n'),
    resolveDir: process.cwd(),
  },
  bundle: true,
  external: ['xstream'],
  banner: { js: 'const window = {};' },
  platform: 'node',
  write: false,
});
const testModule = { exports: {} };
new Function('require', 'module', 'localStorage', outputFiles[0].text)(
  require, testModule, { getItem: () => null, removeItem() {} },
);
const {
  allocateSlices, canStart, defaultTwapOrder, twapIntent, twapModel, twapRequest, twapSection,
} = testModule.exports;
before(() => testModule.exports.saveCredentials({ key: 'test-key', secret: 'test-secret' }));

const twap = { interval: 1, remaining: 0, slices: 29 };

test('previews TWAP slices and enables both sides at the exact minimum', () => {
  const { children: [, , , , status, buttons] } = twapSection({ size: 0.029, twap }, true);
  assert.equal(status.text, '0.001 x 29 every 1 sec');
  assert.deepEqual(buttons.children.map((button) => button.data.attrs.disabled), [false, false]);
});

test('keeps both sides disabled one unit below the required total', () => {
  const { children: [, , , , status, buttons] } = twapSection({ size: 0.02899999, twap }, true);
  assert.equal(status.text, '0.001 x 28 + 0.00099999 x 1 every 1 sec');
  assert.deepEqual(buttons.children.map((button) => button.data.attrs.disabled), [true, true]);
});

test('discards fractional units and supports scientific notation', () => {
  assert.deepEqual(allocateSlices(0.289999999, 29), { baseSize: 0.00999999, largerSize: 0.01, largerCount: 28 });
  assert.equal(allocateSlices(2.9e-7, 29).baseSize, 1e-8);
  assert.equal(allocateSlices(9e-9, 1).baseSize, 0);
});

test('schedules all 29 requests at the exact minimum size', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const start$ = Stream.create();
  const scheduleId = Symbol();
  const requests = [];
  const subscription = twapRequest({
    onTwapStarted$: start$,
    onClickTwapCancelButton$: Stream.never(),
  }, Stream.of({ size: 0.029, twap })).requests$.subscribe({ next: (request) => requests.push(request) });
  t.after(() => subscription.unsubscribe());

  start$.shamefullySendNext({ id: scheduleId, side: 'BUY' });
  assert.equal(requests.length, 1);
  for (let index = 1; index < twap.slices; index++) {
    t.mock.timers.tick(1000);
  }
  assert.equal(requests.length, 29);
  assert.ok(requests.every(({ category, send, scheduleId: requestScheduleId }) =>
    category === 'twap-order' && requestScheduleId === scheduleId && JSON.parse(send).size === 0.001));
});

function setup(t, savedInterval, interval = defaultTwapOrder.interval) {
  const buy$ = Stream.create();
  const sell$ = Stream.create();
  let state = { size: 0.03, twap: { ...defaultTwapOrder, interval, slices: 3 } };
  const state$ = Stream.createWithMemory();
  state$.shamefullySendNext(state);
  const buttons = { ".buy-button": buy$, ".sell-button": sell$ };
  const actions = twapIntent({
    DOM: {
      select: () => ({
        events: () => Stream.never(),
        select: (selector) => ({ events: () => buttons[selector] || Stream.never() }),
      }),
    },
    HTTP: { select: () => Stream.never() },
    storage: { local: { getItem: (key) => Stream.of(key === "twap-interval" ? savedInterval : null) } },
  }, state$);
  const scheduler = twapRequest(actions, state$);
  const modelSubscription = twapModel(actions, scheduler.lifecycle$).subscribe({
    next: (reducer) => {
      state = reducer(state);
      state$.shamefullySendNext(state);
    },
  });
  const requests = [];
  const requestSubscription = scheduler.requests$.subscribe({
    next: (request) => requests.push(request),
  });
  t.after(() => {
    modelSubscription.unsubscribe();
    requestSubscription.unsubscribe();
  });
  return { buy$, sell$, requests, getState: () => state };
}

test("TWAP start eligibility respects the browser timer limit", () => {
  const eligible = (interval) => canStart({ ...defaultTwapOrder, interval, slices: 3 }, 0.03);
  assert.equal(eligible(2147483.647), true);
  for (const interval of [2147483.648, 2147484, Number.MAX_VALUE, Infinity, -Infinity, NaN, 0, -1]) {
    assert.equal(eligible(interval), false, String(interval));
  }
});

test("invalid saved intervals keep TWAP idle with no order requests", (t) => {
  for (const interval of ["2147484", "Infinity", "-Infinity", "NaN"]) {
    const { buy$, sell$, requests, getState } = setup(t, interval);
    assert.equal(canStart(getState().twap, 0.03), false, interval);
    buy$.shamefullySendNext(null);
    sell$.shamefullySendNext(null);
    assert.equal(getState().twap.remaining, 0, interval);
    assert.deepEqual(requests, [], interval);
  }
});

test("TWAP rejects invalid intervals supplied directly in state", (t) => {
  for (const interval of [2147484, Number.MAX_VALUE, Infinity, NaN]) {
    const { buy$, sell$, requests, getState } = setup(t, null, interval);
    buy$.shamefullySendNext(null);
    sell$.shamefullySendNext(null);
    assert.equal(getState().twap.remaining, 0, String(interval));
    assert.deepEqual(requests, [], String(interval));
  }
});

test("a valid saved interval submits the first slice immediately and spaces the rest", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { buy$, requests, getState } = setup(t, "2.5");
  assert.equal(getState().twap.interval, 2.5);

  buy$.shamefullySendNext(null);
  assert.equal(requests.length, 1);
  t.mock.timers.tick(2499);
  assert.equal(requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(requests.length, 2);
  t.mock.timers.tick(2499);
  assert.equal(requests.length, 2);
  t.mock.timers.tick(1);
  t.mock.timers.tick(2500);
  assert.deepEqual(requests.map(({ category, send }) => {
    const { side, size } = JSON.parse(send);
    return [category, side, size];
  }), [
    ["twap-order", "BUY", 0.01],
    ["twap-order", "BUY", 0.01],
    ["twap-order", "BUY", 0.01],
  ]);
});

test('shows the timer limit and disables both sides for an overflowing interval', () => {
  const { children: [, , , intervalHelp, , buttons] } = twapSection({
    size: 0.29,
    twap: { ...twap, interval: 2147483.648 },
  }, true);
  assert.match(intervalHelp.text, /2147483\.647 seconds/);
  assert.deepEqual(buttons.children.map((button) => button.data.attrs.disabled), [true, true]);
});
