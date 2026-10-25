'use strict';
// Seeded synthetic random-walk OHLC. Always stored with is_demo=1 and shown as "Demo Data".
function demoCsv() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let p = 100; const d = new Date('2025-01-01T00:00:00Z'); const rows = ['date,open,high,low,close'];
  for (let i = 0; i < 260; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const o = p, c = o * (1 + (rnd() - 0.48) * 0.03), h = Math.max(o, c) * (1 + rnd() * 0.01), l = Math.min(o, c) * (1 - rnd() * 0.01);
    rows.push(`${d.toISOString().slice(0, 10)},${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${c.toFixed(2)}`); p = c;
  }
  return rows.join('\n');
}
module.exports = { demoCsv };
