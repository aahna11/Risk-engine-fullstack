'use strict';
require('dotenv').config();
const path = require('path'), express = require('express'), helmet = require('helmet'), cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const pool = require('./db'), calc = require('./calc'), { parseCsv } = require('./csv'), { demoCsv } = require('./demo');
const { JWT_SECRET, DEMO_SIGNUP_PASSWORD } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 24) { console.error('Set JWT_SECRET (24+ chars) in .env'); process.exit(1); }
const prod = process.env.NODE_ENV === 'production';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY = bcrypt.hashSync('timing-equaliser', 12);
const today = () => new Date().toISOString().slice(0, 10);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const act = (db, uid, action, detail = '') => db.query('INSERT INTO activity(user_id,action,detail) VALUES (?,?,?)', [uid, action, String(detail).slice(0, 500)]);
const num = (v, d) => (v === undefined || v === '' || v === null ? d : Number(v));
const cleanName = s => String(s || 'dataset.csv').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 200) || 'dataset.csv';
const setCookie = (res, uid) => res.cookie('token', jwt.sign({ uid }, JWT_SECRET, { expiresIn: '7d' }), { httpOnly: true, sameSite: 'strict', secure: prod, maxAge: 7 * 864e5 });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], workerSrc: ["'self'", 'blob:'] } } }));
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
// CSRF defence: cookie is SameSite=Strict AND state-changing calls need a custom header (blocked cross-site by CORS).
app.use('/api', (req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('X-Requested-With') === 'risk-engine') ? next() : bad(res, 'Missing request header.', 403));

function auth(req, res, next) {
  try { req.uid = jwt.verify(req.cookies.token || '', JWT_SECRET).uid; next(); } catch (e) { bad(res, 'Please log in.', 401); }
}

/* ---------- Auth ---------- */
app.post('/api/auth/signup', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  if (!EMAIL.test(email) || email.length > 254) return bad(res, 'Enter a valid email.');
  if (DEMO_SIGNUP_PASSWORD) { if (pw !== DEMO_SIGNUP_PASSWORD) return bad(res, 'Demo signup requires the assignment demo password.'); }
  else if (pw.length < 10 || pw.length > 128) return bad(res, 'Password must be 10-128 characters.');
  const hash = await bcrypt.hash(pw, 12), conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query('INSERT INTO users(email,password_hash) VALUES (?,?)', [email, hash]);
    await conn.query('INSERT INTO settings(user_id) VALUES (?)', [r.insertId]);
    await act(conn, r.insertId, 'signup', email);
    await conn.commit(); setCookie(res, r.insertId); res.json({ user: { id: r.insertId, email } });
  } catch (e) { await conn.rollback(); if (e.code === 'ER_DUP_ENTRY') return bad(res, 'Could not create an account with these details.', 409); throw e; }
  finally { conn.release(); }
}));
app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  const [[u]] = await pool.query('SELECT id,email,password_hash FROM users WHERE email=?', [email]);
  const ok = await bcrypt.compare(pw, u ? u.password_hash : DUMMY);
  if (!u || !ok) return bad(res, 'Invalid email or password.', 401);
  await act(pool, u.id, 'login'); setCookie(res, u.id); res.json({ user: { id: u.id, email: u.email } });
}));
app.post('/api/auth/logout', wrap(async (req, res) => {
  try { const { uid } = jwt.verify(req.cookies.token || '', JWT_SECRET); await act(pool, uid, 'logout'); } catch (e) { /* not logged in */ }
  res.clearCookie('token'); res.json({ ok: true });
}));
app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const [[u]] = await pool.query('SELECT id,email FROM users WHERE id=?', [req.uid]);
  if (!u) return bad(res, 'Please log in.', 401);
  const [[last]] = await pool.query('SELECT action,detail,created_at FROM activity WHERE user_id=? ORDER BY id DESC LIMIT 1', [req.uid]);
  res.json({ user: u, latestActivity: last || null });
}));

/* ---------- Datasets ---------- */
async function storeDataset(uid, name, csv, isDemo) {
  const parsed = parseCsv(csv), conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query('INSERT INTO datasets(user_id,name,is_demo,row_count,rejected_count,warnings) VALUES (?,?,?,?,?,?)', [uid, name, isDemo ? 1 : 0, parsed.bars.length, parsed.rejected, JSON.stringify(parsed.warnings)]);
    for (let i = 0; i < parsed.bars.length; i += 1000) {
      await conn.query('INSERT INTO bars(dataset_id,d,o,h,l,c) VALUES ?', [parsed.bars.slice(i, i + 1000).map(b => [r.insertId, b.d, b.o, b.h, b.l, b.c])]);
    }
    await act(conn, uid, 'upload', `${name}: ${parsed.bars.length} rows, ${parsed.rejected} rejected`);
    await conn.commit();
    return { id: r.insertId, name, isDemo, rows: parsed.bars.length, rejected: parsed.rejected, warnings: parsed.warnings, totalRows: parsed.total };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
app.get('/api/datasets', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id,name,is_demo,row_count,rejected_count,warnings,created_at FROM datasets WHERE user_id=? ORDER BY id DESC', [req.uid]);
  res.json({ datasets: rows.map(d => ({ id: d.id, name: d.name, isDemo: !!d.is_demo, rows: d.row_count, rejected: d.rejected_count, warnings: typeof d.warnings === 'string' ? JSON.parse(d.warnings) : (d.warnings || []), createdAt: d.created_at })) });
}));
app.post('/api/datasets', auth, wrap(async (req, res) => {
  const name = cleanName(req.body.name);
  if (!/\.csv$/i.test(name)) return bad(res, 'Only .csv files are supported.');
  if (typeof req.body.csv !== 'string') return bad(res, 'Missing file contents.');
  res.json({ dataset: await storeDataset(req.uid, name, req.body.csv, false) });
}));
app.post('/api/datasets/demo', auth, wrap(async (req, res) => res.json({ dataset: await storeDataset(req.uid, 'Demo Data (synthetic)', demoCsv(), true) })));
app.delete('/api/datasets/:id', auth, wrap(async (req, res) => {
  const [[d]] = await pool.query('SELECT name FROM datasets WHERE id=? AND user_id=?', [+req.params.id, req.uid]);
  if (!d) return bad(res, 'Dataset not found.', 404);
  await pool.query('DELETE FROM datasets WHERE id=? AND user_id=?', [+req.params.id, req.uid]);
  await act(pool, req.uid, 'delete_dataset', d.name); res.json({ ok: true });
}));

/* ---------- Analysis ---------- */
const readParams = s => ({ atr: num(s.atr, 14), mult: num(s.mult, 2), dir: s.dir || 'long', conf: num(s.conf, 0.95), risk: num(s.risk, 1), entry: num(s.entry, null), kellyFrac: num(s.kellyFrac, 0.5), pointValue: num(s.pointValue, 1) });
async function analyse(uid, id, src) {
  const [[ds]] = await pool.query('SELECT id,name,is_demo,row_count,rejected_count,warnings,created_at FROM datasets WHERE id=? AND user_id=?', [id, uid]);
  if (!ds) return null;
  const p = readParams(src);
  if (!(p.kellyFrac > 0 && p.kellyFrac <= 1)) throw new calc.CalcError('Kelly fraction must be in (0, 1].');
  const [[st]] = await pool.query('SELECT equity FROM settings WHERE user_id=?', [uid]);
  const [rows] = await pool.query('SELECT d,o,h,l,c FROM bars WHERE dataset_id=? ORDER BY d', [id]);
  const bars = rows.map(r => ({ d: r.d, o: +r.o, h: +r.h, l: +r.l, c: +r.c }));
  const last = bars[bars.length - 1].c, entry = p.entry == null ? last : p.entry, equity = +st.equity;
  const a = calc.atr(bars, p.atr), sl = calc.stopLevel(entry, a, p.mult, p.dir);
  const sizing = calc.positionSize({ equity, riskPct: p.risk, entry, stop: sl.stop, pointValue: p.pointValue });
  const rets = calc.returnsFromBars(bars), v = calc.historicalVaR(rets, p.conf), k = calc.kelly(rets, { fraction: p.kellyFrac });
  return {
    dataset: { id: ds.id, name: ds.name, isDemo: !!ds.is_demo, rows: ds.row_count, rejected: ds.rejected_count, warnings: typeof ds.warnings === 'string' ? JSON.parse(ds.warnings) : (ds.warnings || []), createdAt: ds.created_at, from: bars[0].d, to: bars[bars.length - 1].d },
    params: { ...p, entry, equity }, last, atr: a, stopDistance: sl.distance, stop: sl.stop, sizing, kelly: k,
    var: { fractionLoss: v.fractionLoss, estLoss: v.fractionLoss * equity, confidence: v.confidence, observations: v.observations, lookback: `${bars[0].d} to ${bars[bars.length - 1].d}`, holdingPeriod: '1 trading day (bar-to-bar)', method: 'Historical simulation on close-to-close returns applied to account equity' },
    drawdown: calc.maxDrawdown(bars), closes: bars.map(b => b.c)
  };
}
app.get('/api/datasets/:id/analysis', auth, wrap(async (req, res) => {
  const out = await analyse(req.uid, +req.params.id, req.query);
  out ? res.json(out) : bad(res, 'Dataset not found.', 404);
}));
app.post('/api/datasets/:id/analysis', auth, wrap(async (req, res) => {
  const out = await analyse(req.uid, +req.params.id, req.body || {});
  if (!out) return bad(res, 'Dataset not found.', 404);
  const { closes, ...results } = out;
  await pool.query('INSERT INTO analyses(user_id,dataset_id,method,params,results) VALUES (?,?,?,?,?)', [req.uid, out.dataset.id, 'ATR Wilder; fixed-fractional; Kelly; historical VaR', JSON.stringify(out.params), JSON.stringify(results)]);
  await act(pool, req.uid, 'analysis_saved', `${out.dataset.name} ATR(${out.params.atr})x${out.params.mult}`);
  res.json({ saved: true });
}));

/* ---------- Settings / risk / kill switch (simulated trades only) ---------- */
app.get('/api/settings', auth, wrap(async (req, res) => {
  const [[s]] = await pool.query('SELECT equity,daily_loss_pct FROM settings WHERE user_id=?', [req.uid]);
  res.json({ equity: +s.equity, dailyLossPct: +s.daily_loss_pct });
}));
app.put('/api/settings', auth, wrap(async (req, res) => {
  const eq = Number(req.body.equity), pct = Number(req.body.dailyLossPct);
  if (!Number.isFinite(eq) || eq < 1 || eq > 1e12) return bad(res, 'Equity must be between 1 and 1e12.');
  if (!Number.isFinite(pct) || pct < 0.1 || pct > 100) return bad(res, 'Daily loss limit must be 0.1-100%.');
  await pool.query('UPDATE settings SET equity=?, daily_loss_pct=? WHERE user_id=?', [eq, pct, req.uid]);
  await act(pool, req.uid, 'settings', `equity=${eq}, dailyLoss=${pct}%`); res.json({ equity: eq, dailyLossPct: pct });
}));
async function riskState(db, uid) {
  const day = today();
  const [[s]] = await db.query('SELECT equity,daily_loss_pct FROM settings WHERE user_id=?', [uid]);
  const [[d]] = await db.query('SELECT pnl,triggered FROM daily_pnl WHERE user_id=? AND day=?', [uid, day]);
  return { day, pnl: d ? +d.pnl : 0, triggered: d ? !!d.triggered : false, limit: +s.equity * +s.daily_loss_pct / 100, equity: +s.equity, dailyLossPct: +s.daily_loss_pct, convention: 'Day = UTC calendar day. P&L = sum of simulated trade P&L. Triggers when P&L <= -(equity x limit%).' };
}
app.get('/api/risk', auth, wrap(async (req, res) => res.json(await riskState(pool, req.uid))));
app.post('/api/trades', auth, wrap(async (req, res) => {
  const pnl = Number(req.body.pnl);
  if (!Number.isFinite(pnl) || Math.abs(pnl) > 1e9) return bad(res, 'P&L must be a number.');
  const conn = await pool.getConnection(), day = today();
  try {
    await conn.beginTransaction();
    const [[s]] = await conn.query('SELECT equity,daily_loss_pct FROM settings WHERE user_id=? FOR UPDATE', [req.uid]);
    await conn.query('INSERT INTO daily_pnl(user_id,day,pnl,triggered) VALUES (?,?,0,0) ON DUPLICATE KEY UPDATE user_id=user_id', [req.uid, day]);
    const [[d]] = await conn.query('SELECT pnl,triggered FROM daily_pnl WHERE user_id=? AND day=? FOR UPDATE', [req.uid, day]);
    const limit = +s.equity * +s.daily_loss_pct / 100;
    if (d.triggered) {
      await conn.query('INSERT INTO risk_events(user_id,type,details) VALUES (?,?,?)', [req.uid, 'BLOCKED', JSON.stringify({ attemptedPnl: pnl, dayPnl: +d.pnl, limit })]);
      await act(conn, req.uid, 'trade_blocked', `Blocked simulated trade (P&L ${pnl}); kill switch active`);
      await conn.commit();
      return bad(res, 'Kill switch active: new simulated trades are blocked for today.', 423);
    }
    const np = +d.pnl + pnl, trig = np <= -limit;
    await conn.query('INSERT INTO trades(user_id,day,pnl) VALUES (?,?,?)', [req.uid, day, pnl]);
    await conn.query('UPDATE daily_pnl SET pnl=?, triggered=?, triggered_at=IF(?=1,NOW(),NULL) WHERE user_id=? AND day=?', [np, trig ? 1 : 0, trig ? 1 : 0, req.uid, day]);
    await act(conn, req.uid, 'trade', `Simulated trade P&L ${pnl}`);
    if (trig) {
      await conn.query('INSERT INTO risk_events(user_id,type,details) VALUES (?,?,?)', [req.uid, 'TRIGGERED', JSON.stringify({ dayPnl: np, limit, equity: +s.equity, dailyLossPct: +s.daily_loss_pct })]);
      await act(conn, req.uid, 'kill_switch', `Triggered: day P&L ${np} <= -${limit}`);
    }
    await conn.commit(); res.json(await riskState(pool, req.uid));
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));
// Reset policy: manual, explicit confirmation. Clears the flag only; day P&L is kept, so the next trade re-triggers
// unless the limit/equity was raised. A new UTC day starts fresh automatically.
app.post('/api/risk/reset', auth, wrap(async (req, res) => {
  if (req.body.confirm !== 'RESET') return bad(res, 'Type RESET to confirm.');
  const [r] = await pool.query('UPDATE daily_pnl SET triggered=0 WHERE user_id=? AND day=? AND triggered=1', [req.uid, today()]);
  if (!r.affectedRows) return bad(res, 'Kill switch is not active.', 409);
  await pool.query('INSERT INTO risk_events(user_id,type,details) VALUES (?,?,?)', [req.uid, 'RESET', JSON.stringify({ day: today() })]);
  await act(pool, req.uid, 'kill_switch_reset', 'Manual reset'); res.json(await riskState(pool, req.uid));
}));
app.get('/api/activity', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT action,detail,created_at FROM activity WHERE user_id=? ORDER BY id DESC LIMIT 30', [req.uid]);
  res.json({ activity: rows });
}));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.use((err, req, res, next) => { // eslint-disable-line
  if (err instanceof calc.CalcError) return bad(res, err.message);
  if (err.type === 'entity.too.large') return bad(res, 'File too large (max ~5 MB).', 413);
  if (err.type === 'entity.parse.failed') return bad(res, 'Invalid JSON.');
  console.error(err); bad(res, 'Server error.', 500);
});
const port = +process.env.PORT || 3000;
app.listen(port, () => console.log(`Risk Engine running at http://localhost:${port}`));
module.exports = app;