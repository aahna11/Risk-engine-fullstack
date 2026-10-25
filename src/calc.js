'use strict';
/* Formulas:
 * TR = max(H-L, |H-prevC|, |L-prevC|); first ATR = mean(TR[1..n]); ATR = (prev*(n-1)+TR)/n  (Wilder)
 * Stop: long = entry - mult*ATR; short = entry + mult*ATR
 * Size = (equity*risk%) / (|entry-stop| * pointValue)
 * Kelly = p - (1-p)/b, b = avgWin/avgLoss (positive magnitudes)
 * Historical VaR: loss fraction = -(empirical (1-conf) quantile of returns), clamped at 0 */
class CalcError extends Error { constructor(m) { super(m); this.name = 'CalcError'; } }
const isNum = v => typeof v === 'number' && Number.isFinite(v);

function validateBars(bars, minRows = 2) {
  if (!Array.isArray(bars) || bars.length < minRows) throw new CalcError(`Need at least ${minRows} bars.`);
  bars.forEach((b, i) => {
    if (![b.o, b.h, b.l, b.c].every(v => isNum(v) && v > 0)) throw new CalcError(`Bar ${i}: prices must be positive numbers.`);
    if (b.h < b.l || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c)) throw new CalcError(`Bar ${i}: high/low inconsistent with open/close.`);
    if (i && !(b.d > bars[i - 1].d)) throw new CalcError(`Bar ${i}: dates must be strictly ascending.`);
  });
}
function trueRanges(bars) {
  validateBars(bars);
  return bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
}
function atr(bars, n = 14) {
  if (!Number.isInteger(n) || n < 1 || n > 250) throw new CalcError('ATR period must be an integer 1-250.');
  validateBars(bars);
  if (bars.length < n + 1) throw new CalcError(`ATR(${n}) needs at least ${n + 1} bars.`);
  const tr = trueRanges(bars);
  let a = tr.slice(1, n + 1).reduce((s, v) => s + v, 0) / n;
  for (let i = n + 1; i < bars.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}
function stopLevel(entry, atrValue, mult, dir) {
  if (!isNum(entry) || entry <= 0) throw new CalcError('Entry must be positive.');
  if (!isNum(mult) || mult <= 0) throw new CalcError('Multiplier must be positive.');
  if (dir !== 'long' && dir !== 'short') throw new CalcError('Direction must be long or short.');
  const distance = atrValue * mult;
  const stop = dir === 'long' ? entry - distance : entry + distance;
  if (stop <= 0) throw new CalcError('Stop price would be zero or negative; reduce the multiplier.');
  return { distance, stop };
}
function positionSize({ equity, riskPct, entry, stop, pointValue = 1 }) {
  if (![equity, riskPct, entry, stop, pointValue].every(isNum)) throw new CalcError('All sizing inputs must be numbers.');
  if (equity <= 0 || riskPct <= 0 || riskPct > 100 || entry <= 0 || stop <= 0 || pointValue <= 0) throw new CalcError('Sizing inputs out of range.');
  const dist = Math.abs(entry - stop);
  if (dist === 0) throw new CalcError('Entry and stop must differ.');
  const riskAmount = equity * riskPct / 100;
  const size = riskAmount / (dist * pointValue);
  return { riskAmount, distance: dist, size, estRisk: size * dist * pointValue };
}
function returnsFromBars(bars) { return bars.slice(1).map((b, i) => b.c / bars[i].c - 1); }
function kelly(returns, { minN = 30, fraction = 1 } = {}) {
  const n = returns.length;
  const out = { valid: false, n, reason: '', p: null, b: null, kelly: null, allocation: null, fraction };
  if (n < minN) { out.reason = `Only ${n} observations; at least ${minN} required.`; return out; }
  const W = returns.filter(r => r > 0), L = returns.filter(r => r < 0);
  if (!W.length || !L.length) { out.reason = 'Need both winning and losing periods.'; return out; }
  const p = W.length / n, avgW = W.reduce((s, v) => s + v, 0) / W.length, avgL = -L.reduce((s, v) => s + v, 0) / L.length;
  if (!(avgL > 0) || !(avgW > 0)) { out.reason = 'Average win/loss is zero.'; return out; }
  const b = avgW / avgL, k = p - (1 - p) / b;
  if (!Number.isFinite(k)) { out.reason = 'Undefined Kelly value.'; return out; }
  // p = wins / all observations (flat periods count as non-wins); documented assumption
  return { valid: true, n, reason: k <= 0 ? 'No positive edge in this sample: allocate 0%.' : '', p, b, kelly: k, allocation: Math.min(Math.max(k * fraction, 0), 1), fraction };
}
function historicalVaR(returns, conf = 0.95, minN = 30) {
  if (![0.9, 0.95, 0.99].includes(conf)) throw new CalcError('Confidence must be 0.90, 0.95 or 0.99.');
  if (returns.length < minN) throw new CalcError(`VaR needs at least ${minN} return observations.`);
  const s = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - conf) * s.length + 1e-9);
  return { fractionLoss: Math.max(-s[idx], 0), observations: s.length, confidence: conf };
}
function maxDrawdown(bars) {
  let peak = bars[0].c, dd = 0;
  for (const b of bars) { peak = Math.max(peak, b.c); dd = Math.max(dd, (peak - b.c) / peak); }
  return dd;
}
module.exports = { CalcError, validateBars, trueRanges, atr, stopLevel, positionSize, returnsFromBars, kelly, historicalVaR, maxDrawdown };
