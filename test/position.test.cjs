const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Position } = require('../src/models/position.ts');

test('calculates position size, weighted entry price, and profit from fills', () => {
  const position = new Position([
    { side: 'BUY', size: 0.25, price: 40000 },
    { side: 'BUY', size: 0.75, price: 44000 },
  ]);

  assert.equal(position.size, 1);
  assert.equal(position.price, 43000);
  assert.equal(position.profit(45000), 2000);
});

test('calculates a loss when the market rises against a short position', () => {
  const position = new Position([{ side: 'SELL', size: 0.5, price: 40000 }]);

  assert.equal(position.size, -0.5);
  assert.equal(position.profit(42000), -1000);
});

test('reports no position when there are no fills', () => {
  const position = new Position([]);

  assert.equal(position.toPriceString(), 'None');
  assert.equal(position.toSizeString(), 'None');
  assert.equal(position.toDiffString(42000), 'None');
  assert.equal(position.toProfitString(42000), 'None');
});
