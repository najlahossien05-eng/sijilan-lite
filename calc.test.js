// Run: node --test calc.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('./calc.js');

const S = { pctA: 5, pctB: 15, comm: 2, amountC: 500 };

test('parseAmount sums, accepts Arabic digits and commas', () => {
  assert.strictEqual(C.parseAmount('1,500+2300-300'), 3500);
  assert.strictEqual(C.parseAmount('١٢٠٠+٣٠٠'), 1500);
  assert.strictEqual(C.parseAmount(''), 0);
  assert.strictEqual(C.parseAmount('12a'), null);
  assert.strictEqual(C.parseAmount('10.5'), 10.5);
});

test('distribution matches the full app formula', () => {
  const r = C.calculate({ a: 10000, b: 20000, applyC: true }, S);
  assert.strictEqual(r.discA, 500);
  assert.strictEqual(r.discB, 3000);
  assert.strictEqual(r.pool, 3500);
  assert.strictEqual(r.poolAfterC, 3000);
  assert.strictEqual(r.halfA, 1500);
  assert.strictEqual(r.commA, 190);   // 9500 * 2%
  assert.strictEqual(r.commB, 340);   // 17000 * 2%
  assert.strictEqual(r.finalA, 10810); // 9500 + 1500 - 190
  assert.strictEqual(r.finalB, 16660); // 17000 - 340
  assert.strictEqual(r.transfer, 27470);
  // Every riyal is accounted for.
  assert.strictEqual(C.round2(r.finalA + r.finalB + r.asim + r.shareC + r.commTotal), r.total);
});

test('share C off leaves the whole pool to split', () => {
  const r = C.calculate({ a: 600, b: 0, applyC: false }, S);
  assert.strictEqual(r.shareC, 0);
  assert.strictEqual(r.halfA, 15);
  assert.strictEqual(r.finalA, 573.6); // same number the full app showed for 600
});

test('individual calculator', () => {
  const r = C.calculateIndividual(1000, S);
  assert.deepStrictEqual([r.disc, r.comm, r.net], [150, 17, 833]);
});

test('sumResults adds up saved operations', () => {
  const a = C.calculate({ a: 1000, b: 0 }, S);
  const b = C.calculate({ a: 0, b: 1000 }, S);
  const sum = C.sumResults([a, b]);
  assert.strictEqual(sum.count, 2);
  assert.strictEqual(sum.transfer, C.round2(a.transfer + b.transfer));
});
