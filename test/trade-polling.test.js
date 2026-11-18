const assert = require('node:assert/strict');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: ['board', 'trade', 'summary'].flatMap((component) => {
      const directory = component === 'trade' ? 'trade' : `trade/${component}`;
      return ['intent', 'model'].map((name) =>
        `export { ${name} as ${component}_${name} } from "./src/components/${directory}/${name}";`);
    }).join('\n'),
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  write: false,
});
const testModule = { exports: {} };
runInNewContext(outputFiles[0].text, { module: testModule, require });
const components = testModule.exports;

const tests = [
  {
    component: 'board', category: 'board',
    first: { asks: [{ price: 102, size: 1 }], bids: [] },
    invalid: [{ asks: [{ price: 102 }], bids: [] }, { asks: [] }],
    next: { asks: [{ price: 103, size: 1 }], bids: [] },
    read: (state) => state.board.asks[0].price, expected: [102, 103],
  },
  {
    component: 'trade', category: 'positions',
    first: [{ side: 'SELL', price: 100, size: 1 }],
    invalid: [null, [{ side: 'SELL', price: 100, size: '1' }]],
    next: [],
    read: (state) => state.position.size, expected: [-1, 0],
  },
  {
    component: 'summary', category: 'collateral',
    first: { collateral: 100 }, invalid: [{}, { collateral: '100' }],
    next: { collateral: 0 },
    read: (state) => state.collateral, expected: [100, 0],
  },
  {
    component: 'summary', category: 'status',
    first: { health: 'NORMAL', state: 'RUNNING' },
    invalid: [null, { health: 'NORMAL' }],
    next: { health: 'BUSY', state: 'RUNNING' },
    read: (state) => state.marketState.health, expected: ['NORMAL', 'BUSY'],
  },
];

for (const { component, category, first, invalid, next, read, expected } of tests) {
  test(`${category} keeps its last valid state and recovers on the next valid poll`, () => {
    const responses = Stream.create();
    const idle = Stream.never();
    const dom = { select: () => dom, events: () => idle };
    const actions = components[`${component}_intent`]({
      DOM: dom,
      storage: { local: { getItem: () => idle } },
      socket: { board$: idle, execution$: idle, childOrderEvent$: idle, parentOrderEvent$: idle },
      HTTP: { select: (name) => name === category ? responses : idle },
    });

    let state;
    const subscription = components[`${component}_model`](actions).subscribe({
      next: (reduce) => { state = reduce(state); },
      error: (error) => { throw error; },
    });
    const respond = (text) => responses.shamefullySendNext(Stream.of({ text }));

    try {
      respond(JSON.stringify(first));
      assert.equal(read(state), expected[0]);
      const lastValidState = state;

      respond('upstream unavailable');
      assert.equal(state, lastValidState);
      for (const value of invalid) {
        respond(JSON.stringify(value));
        assert.equal(state, lastValidState);
      }

      respond(JSON.stringify(next));
      assert.equal(read(state), expected[1]);
    } finally {
      subscription.unsubscribe();
    }
  });
}
