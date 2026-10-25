'use strict';
const { CalcError } = require('./calc');
const validDate = d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false; const t = new Date(d + 'T00:00:00Z'); return !isNaN(t) && t.toISOString().slice(0, 10) === d; };
function parseCsv(text, { maxRows = 100000, minRows = 20 } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new CalcError('File is empty.');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length - 1 > maxRows) throw new CalcError(`Too many rows (max ${maxRows}).`);
  const head = lines[0].split(',').map(s => s.trim().toLowerCase());
  const ix = {}, missing = [];
  for (const k of ['date', 'open', 'high', 'low', 'close']) { ix[k] = head.indexOf(k); if (ix[k] < 0) missing.push(k); }
  if (missing.length) throw new CalcError('Missing required column(s): ' + missing.join(', ') + '. Expected header: date,open,high,low,close');
  const bars = [], seen = new Set(), samples = [];
  let rejected = 0;
  const rej = (i, why) => { rejected++; if (samples.length < 5) samples.push(`line ${i + 1}: ${why}`); };
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = lines[i].split(',');
    const o = { d: (c[ix.date] || '').trim(), o: Number(c[ix.open]), h: Number(c[ix.high]), l: Number(c[ix.low]), c: Number(c[ix.close]) };
    if (!validDate(o.d)) { rej(i, 'bad date (use YYYY-MM-DD)'); continue; }
    if ([o.o, o.h, o.l, o.c].some(v => !Number.isFinite(v) || v <= 0)) { rej(i, 'missing or non-positive price'); continue; }
    if (o.h < o.l || o.h < Math.max(o.o, o.c) || o.l > Math.min(o.o, o.c)) { rej(i, 'high/low inconsistent'); continue; }
    if (seen.has(o.d)) { rej(i, 'duplicate date'); continue; }
    seen.add(o.d); bars.push(o);
  }
  bars.sort((a, b) => (a.d < b.d ? -1 : 1));
  if (bars.length < minRows) throw new CalcError(`Only ${bars.length} valid rows; at least ${minRows} required.` + (samples.length ? ' Examples: ' + samples.join('; ') : ''));
  const warnings = rejected ? [`${rejected} row(s) rejected. ` + samples.join('; ')] : [];
  return { bars, rejected, warnings, total: lines.length - 1 };
}
module.exports = { parseCsv };
