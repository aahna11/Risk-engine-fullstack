'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const c = require('../src/calc'), { parseCsv } = require('../src/csv'), { demoCsv } = require('../src/demo');
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
const bars = [
  { d: '2025-01-01', o: 9, h: 10, l: 8, c: 9 }, { d: '2025-01-02', o: 10, h: 11, l: 9, c: 10 },
  { d: '2025-01-03', o: 11, h: 12, l: 10, c: 11 }, { d: '2025-01-04', o: 13, h: 14, l: 11, c: 13 }];
test('ATR Wilder known example', () => { near(c.atr(bars, 2), 2.5); });
test('ATR rejects insufficient and bad data', () => {
  assert.throws(() => c.atr(bars, 5), /needs at least/);
  assert.throws(() => c.atr([{ d: '1', o: 1, h: 0.5, l: 1, c: 1 }, { d: '2', o: 1, h: 1, l: 1, c: 1 }], 1), /inconsistent/);
  assert.throws(() => c.atr([bars[1], bars[0], bars[2]], 1), /ascending/);
});
test('stop levels long/short', () => {
  near(c.stopLevel(100, 2.5, 2, 'long').stop, 95); near(c.stopLevel(100, 2.5, 2, 'short').stop, 105);
  assert.throws(() => c.stopLevel(100, 2.5, 2, 'x'));
});
test('fixed-fractional sizing', () => {
  const r = c.positionSize({ equity: 100000, riskPct: 1, entry: 100, stop: 98 });
  near(r.riskAmount, 1000); near(r.size, 500); near(r.estRisk, 1000);
  near(c.positionSize({ equity: 100000, riskPct: 1, entry: 100, stop: 98, pointValue: 10 }).size, 50);
  assert.throws(() => c.positionSize({ equity: 1, riskPct: 1, entry: 5, stop: 5 }));
});
test('Kelly known example and edge cases', () => {
  const r = [...Array(6).fill(0.02), ...Array(4).fill(-0.01)];
  const k = c.kelly(r, { minN: 10 }); assert.ok(k.valid); near(k.kelly, 0.4); near(c.kelly(r, { minN: 10, fraction: 0.5 }).allocation, 0.2);
  assert.equal(c.kelly(r).valid, false);
  assert.equal(c.kelly(Array(40).fill(0.01)).valid, false);
  assert.equal(c.kelly([...Array(20).fill(0.01), ...Array(20).fill(-0.02)]).allocation, 0);
});
test('historical VaR known example', () => {
  const r = Array.from({ length: 100 }, (_, i) => -(i + 1) / 100);
  near(c.historicalVaR(r, 0.95).fractionLoss, 0.95);
  assert.throws(() => c.historicalVaR([0.1, 0.2], 0.95), /at least/);
  assert.throws(() => c.historicalVaR(r, 0.5));
  near(c.historicalVaR(Array(50).fill(0.01), 0.95).fractionLoss, 0);
});
test('CSV parsing: valid, rejects, errors', () => {
  const p = parseCsv(demoCsv()); assert.equal(p.bars.length, 260); assert.equal(p.rejected, 0);
  const bad = demoCsv() + '\n2025-99-99,1,2,1,1\n' + demoCsv().split('\n')[1];
  assert.equal(parseCsv(bad).rejected, 2);
  assert.throws(() => parseCsv('date,open,high,low\n1,2,3,4'), /Missing required/);
  assert.throws(() => parseCsv(''), /empty/);
  assert.throws(() => parseCsv('date,open,high,low,close\n2025-01-01,1,2,1,1'), /at least/);
});
