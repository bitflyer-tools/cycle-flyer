const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { view } from './src/components/trade/summary/view';
      export { Position } from './src/models/position';
    `,
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  platform: 'node',
  external: ['xstream'],
  write: false,
});
const summary = { exports: {} };
compileFunction(outputFiles[0].text, ['module', 'require', 'window'])(summary, require, {});
const { view, Position } = summary.exports;

function rowValue(summaryNode, selector) {
  return summaryNode.children.find((row) => row.sel === selector)
    .children.find((cell) => cell.sel?.startsWith('span.number')).text;
}

test('keeps deposited collateral fixed as market price and position change', () => {
  const collateralResponse = { collateral: 100000, open_position_pnl: -715 };
  const position = new Position([{ side: 'BUY', price: 100000, size: 1 }]);
  const initialState = {
    collateral: collateralResponse.collateral,
    currentPrice: 101000,
    histories: [],
    marketState: { health: 'NORMAL', state: 'RUNNING' },
    position,
  };

  const state$ = Stream.of(
    initialState,
    { ...initialState, currentPrice: 99000 },
    { ...initialState, currentPrice: 99000, position: new Position([]) },
  );

  const renderedRows = [];
  view(state$).addListener({
    next: (node) => renderedRows.push({
      collateral: rowValue(node, 'div.collateral'),
      profit: rowValue(node, 'div.profit'),
    }),
  });

  const deposited = (100000).toLocaleString();
  const profit = (1000).toLocaleString();
  assert.deepEqual(renderedRows, [
    { collateral: deposited, profit },
    { collateral: deposited, profit: `- ${profit}` },
    { collateral: deposited, profit: 'None' },
  ]);
});
