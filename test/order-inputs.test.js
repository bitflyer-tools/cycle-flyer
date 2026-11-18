const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const { outputFiles: [bundle] } = buildSync({
  stdin: {
    contents: `
      export { OrderComponent } from './src/components/trade/order';
      export { default as Stream } from 'xstream';
    `,
    resolveDir: __dirname + '/..',
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  loader: { '.styl': 'empty' },
});
const compiled = { exports: {} };
const loadBundle = new Function('module', 'exports', 'require', 'window', 'localStorage', bundle.text);
loadBundle(compiled, compiled.exports, require, {}, { 'api-key': 'key', 'api-secret': 'secret' });
const { OrderComponent, Stream } = compiled.exports;

function orderPanel() {
  const events = new Map();
  const dom = (path = '') => ({
    select: (selector) => dom(path ? path + ' ' + selector : selector),
    events: (name) => {
      const key = path + ':' + name;
      if (!events.has(key)) events.set(key, Stream.create());
      return events.get(key);
    },
  });
  const state$ = Stream.createWithMemory();
  const sinks = OrderComponent({
    DOM: dom(),
    HTTP: { select: () => Stream.never() },
    state: { stream: state$ },
    storage: { local: { getItem: () => Stream.never() } },
  });
  const requests = [];
  let state;
  let vnode;
  sinks.DOM.addListener({ next: (value) => { vnode = value; } });
  sinks.HTTP.addListener({ next: (value) => requests.push(value) });
  sinks.state.addListener({ next: (reduce) => state$.shamefullySendNext(state = reduce(state)) });
  return {
    requests,
    preset: () => events.get('.size-presets .size-preset:click')
      .shamefullySendNext({ currentTarget: { dataset: { size: '0.01' } } }),
    input: (field, value) => events.get(`#${field}-input:input`).shamefullySendNext({ target: { value } }),
    click: (type, side) => events.get(`.${type}-order-buttons .${side}-button:click`).shamefullySendNext({}),
    disabled: (type) => vnode.children.flatMap((section) => section.children || [])
      .find((group) => group.sel === `div.${type}-order-buttons.order-buttons`).children
      .filter((child) => child.sel.startsWith('button.'))
      .map((child) => child.data.attrs.disabled),
  };
}

test('allows market orders after choosing a size preset and disables limit orders until a price is entered', () => {
  const panel = orderPanel();
  panel.preset();
  assert.deepEqual(panel.disabled('market'), [false, false]);
  assert.deepEqual(panel.disabled('limit'), [true, true]);
  panel.input('price', '50000');
  assert.deepEqual(panel.disabled('limit'), [false, false]);
});

test('rejects invalid numeric inputs without emitting an HTTP request or entering the pending state', () => {
  const panel = orderPanel();
  panel.input('price', '50000');
  ['abc', '', '-1', 'Infinity'].forEach((size) => {
    panel.input('size', size);
    ['market', 'limit'].forEach((type) => {
      assert.deepEqual(panel.disabled(type), [true, true]);
      ['buy', 'sell'].forEach((side) => panel.click(type, side));
    });
  });

  panel.preset();
  ['abc', '', '-1', 'Infinity'].forEach((price) => {
    panel.input('price', price);
    assert.deepEqual(panel.disabled('limit'), [true, true]);
    ['buy', 'sell'].forEach((side) => panel.click('limit', side));
    assert.deepEqual(panel.disabled('market'), [false, false]);
  });
  assert.deepEqual(panel.requests, []);
});

test('preserves the HTTP payloads for valid market and limit orders on both sides', () => {
  ['market', 'limit'].forEach((type) => {
    ['buy', 'sell'].forEach((side) => {
      const panel = orderPanel();
      panel.preset();
      panel.input('price', type === 'limit' ? '50000' : 'abc');
      panel.click(type, side);
      assert.equal(panel.requests.length, 1);
      const [request] = panel.requests;
      assert.equal(request.category, type + '-order');
      assert.equal(request.method, 'POST');
      assert.equal(new URL(request.url).pathname, '/v1/me/sendchildorder');
      assert.deepEqual(JSON.parse(request.send), {
        child_order_type: type.toUpperCase(),
        product_code: 'FX_BTC_JPY',
        side: side.toUpperCase(),
        size: 0.01,
        ...(type === 'limit' ? { price: 50000 } : {}),
      });
      assert.deepEqual(panel.disabled(type), [true, true]);
    });
  });
});
