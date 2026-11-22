const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { buildSync } = require('esbuild');
const Stream = require('xstream').default;

const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { synchronizeBoard } from './src/components/trade/board/synchronizeBoard';
      export { view } from './src/components/trade/summary/view';
      export { Board } from './src/models/board';
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
const { Board, Position, synchronizeBoard, view } = summary.exports;

function rowValue(summaryNode, selector) {
  return rowNumber(summaryNode, selector).text;
}

function rowNumber(summaryNode, selector) {
  return summaryNode.children.find((row) => row.sel === selector)
    .children.find((cell) => cell.sel?.startsWith('span.number'));
}

test('uses the displayed P&L to color gains and keeps zero neutral for both sides', () => {
  const states = [
    { side: 'BUY', currentPrice: 40001 },
    { side: 'SELL', currentPrice: 40000 },
  ].flatMap(({ side, currentPrice }) => {
    const position = new Position([
      { side, size: 1, price: 40000 },
      { side, size: 1, price: 40001 },
    ]);
    return [
      { position, currentPrice },
      { position, currentPrice: 40000.5 },
      { position: new Position([{ side, size: 0.5, price: 40000 }]),
        currentPrice: side === 'BUY' ? 40001 : 39999 },
    ];
  }).map((state) => ({
    collateral: 0,
    histories: [],
    marketState: { health: 'NORMAL', state: 'RUNNING' },
    ...state,
  }));
  const rendered = [];
  view(Stream.fromArray(states)).addListener({
    next: (node) => {
      const { sel, text } = rowNumber(node, 'div.profit');
      rendered.push([sel, text]);
    },
  });

  assert.deepEqual(rendered, [
    ['span.number.plus', '1'], ['span.number', '0'], ['span.number', '0'],
    ['span.number.plus', '1'], ['span.number', '0'], ['span.number', '0'],
  ]);
});

test('renders once across 100 board-only deltas and updates for each summary input', () => {
  const initialSummary = {
    collateral: 100000,
    currentPrice: 101000,
    histories: [],
    marketState: { health: 'NORMAL', state: 'RUNNING' },
    position: new Position([]),
  };
  const deltas = Array.from({ length: 100 }, (_, i) => ({
    asks: [{ price: 102000, size: i + 1 }],
    bids: [],
  }));
  const boardState$ = synchronizeBoard(Stream.fromArray(deltas), Stream.never(), Stream.never(), Stream.of(true))
    .fold((state, reducer) => reducer(state), { board: new Board({ asks: [], bids: [] }) });
  const updates$ = Stream.create();
  let boardEmissions = 0;
  const state$ = Stream.merge(boardState$.map(() => {
    boardEmissions += 1;
    return { ...initialSummary };
  }), updates$);
  const changes = [];
  view(state$).addListener({ next: (node) => changes.push(node) });
  assert.equal(boardEmissions, 102);
  assert.equal(changes.length, 1);

  let state = initialSummary;

  const updates = [
    [{ currentPrice: 102000 }, (node) => rowValue(node, 'div.current-price'), (102000).toLocaleString()],
    [{ position: new Position([{ side: 'BUY', price: 100000, size: 1 }]) },
      (node) => rowValue(node, 'div.position'), (100000).toLocaleString()],
    [{ collateral: 110000 }, (node) => rowValue(node, 'div.collateral'), (110000).toLocaleString()],
    [{ marketState: { health: 'BUSY', state: 'RUNNING' } },
      (node) => node.children.find((row) => row.sel === 'div.market-state').children[1].text, 'BUSY'],
    [{ marketState: { health: 'BUSY', state: 'STOP' } },
      (node) => node.children.find((row) => row.sel === 'div.board-state').children[1].text, 'STOP'],
    [{ histories: [{ name: 'Market order', status: 'success', description: 'BUY', createdAt: new Date(0) }] },
      (node) => node.children.find((row) => row.sel === 'ul.histories').children[0].children[1].text,
      'Market order'],
  ];
  updates.forEach(([update, readValue, expected], index) => {
    state = { ...state, ...update };
    updates$.shamefullySendNext(state);
    assert.equal(changes.length, index + 2);
    assert.equal(readValue(changes.at(-1)), expected);
  });
});

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
