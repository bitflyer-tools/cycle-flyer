const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: [
      'export { sliceSize } from "./src/models/twapOrder";',
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
  require, testModule, { 'api-secret': 'test-secret' },
);
const { sliceSize, twapSection, twapRequest } = testModule.exports;
const twap = { interval: 1, remaining: 0, slices: 29 };

test('previews TWAP slices and enables both sides at the exact minimum', () => {
  const { children: [, , , status, buttons] } = twapSection({ size: 0.29, twap });
  assert.equal(status.text, '0.01 x 29 every 1 sec');
  assert.deepEqual(buttons.children.map((button) => button.data.attrs.disabled), [false, false]);
});

test('keeps both sides disabled one unit below the required total', () => {
  const { children: [, , , status, buttons] } = twapSection({ size: 0.28999999, twap });
  assert.equal(status.text, '0.00999999 x 29 every 1 sec');
  assert.deepEqual(buttons.children.map((button) => button.data.attrs.disabled), [true, true]);
});

test('discards fractional units and supports scientific notation', () => {
  assert.equal(sliceSize(0.289999999, 29), 0.00999999);
  assert.equal(sliceSize(2.9e-7, 29), 1e-8);
  assert.equal(sliceSize(9e-9, 1), 0);
});

test('schedules all 29 requests at the exact minimum size', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const buy$ = Stream.create();
  const requests = [];
  const subscription = twapRequest({
    onClickTwapBuyButton$: buy$,
    onClickTwapSellButton$: Stream.never(),
    onClickTwapCancelButton$: Stream.never(),
  }, Stream.of({ size: 0.29, twap })).subscribe({ next: (request) => requests.push(request) });
  t.after(() => subscription.unsubscribe());

  buy$.shamefullySendNext({});
  assert.equal(requests.length, 1);
  for (let index = 1; index < twap.slices; index++) {
    t.mock.timers.tick(1000);
  }
  assert.equal(requests.length, 29);
  assert.ok(requests.every(({ category, send }) =>
    category === 'twap-order' && JSON.parse(send).size === 0.01));
});
