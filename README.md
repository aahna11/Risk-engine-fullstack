*Live demo:* https://your-url.vercel.app 
    
# Risk & Position Sizing Engine (full-stack)

Node.js + Express backend, MySQL database, and a Three.js 3D frontend (procedural coins, 3D watch risk gauge, market-skyline city, rotate slider) served by Express from `public/`.
Features: signup/login (bcrypt + httpOnly JWT cookie), CSV upload pipeline, ATR stops, fixed-fractional sizing, Kelly, historical VaR,
backend-enforced daily-loss kill switch for **simulated** trades, activity log, saved analyses.

## 1. Requirements
- Node.js 18+ (https://nodejs.org)
- MySQL 8+ running locally (MySQL Community Server, XAMPP, or Docker)

## 2. Create a MySQL user
Open a MySQL shell (`mysql -u root -p`) and run (change the password):
```sql
CREATE USER 'risk_user'@'localhost' IDENTIFIED BY 'change_me';
GRANT ALL PRIVILEGES ON risk_engine.* TO 'risk_user'@'localhost';
GRANT CREATE ON *.* TO 'risk_user'@'localhost';
FLUSH PRIVILEGES;
```

## 3. Install and configure
```bash
npm install
cp .env.example .env        # Windows PowerShell: copy .env.example .env
```
Edit `.env`: set `DB_PASSWORD` and a long random `JWT_SECRET`
(generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

## 4. Create the database tables
```bash
npm run migrate
```
(Creates the `risk_engine` database if missing and applies `migrations/*.sql`; safe to re-run.)

## 5. Start
```bash
npm start
```
Open http://localhost:3000

## 6. Use it
Pages: Home, Sign up/Log in, Upload, Dashboard, Position Sizing, Kill Switch, Activity, Method.
1. Sign up with any email and the demo password **Risktrading101** (demo-only restriction, enforced by the server via `DEMO_SIGNUP_PASSWORD` in `.env`; clear that variable to allow any 10+ character password).
2. Upload `sample-data/bitcoin-style-400-rows.csv` (or choose Load Demo Data, which is clearly labelled).
3. Wait for the progress screen; after the server confirms, you see "Uploading and reading of data is complete" and the dashboard opens.
4. Change ATR/multiplier/risk %, save an analysis, submit simulated trades with negative P&L until the kill switch triggers (further trades are rejected by the backend with HTTP 423).

## 7. Tests
```bash
npm test
```
Unit tests (ATR, stops, sizing, Kelly, VaR, CSV parsing) run without a database.

## CSV format
Header `date,open,high,low,close`; date `YYYY-MM-DD`; prices positive; high >= max(open,close), low <= min(open,close); duplicate dates rejected; min 20 valid rows; max ~5 MB.

## Formulas and conventions
- ATR: Wilder smoothing; first ATR = mean of first n true ranges. Stop = entry -/+ multiplier x ATR.
- Size = (equity x risk%) / (|entry - stop| x point value). Point value is 1 (no FX/contract conversion in the UI).
- Kelly = p - (1-p)/b with b = avg win / avg loss; needs 30+ observations, both wins and losses; fractional Kelly selectable.
- VaR: historical simulation, 1-day close-to-close returns, clamped at 0, applied to account equity. Not a maximum loss.
- Kill switch: UTC day, P&L = sum of simulated trades, triggers at P&L <= -(equity x limit%). Reset is manual (type RESET), clears the flag only and keeps the day's P&L, so it re-triggers on the next trade unless you raise the limit. A new UTC day starts clean. It blocks only this app's simulated trades; it cannot cancel real broker orders.

## Troubleshooting
- `Migration failed: Access denied` -> check DB_USER/DB_PASSWORD in `.env` and the GRANT statements.
- `Set JWT_SECRET` on start -> add a 24+ character JWT_SECRET to `.env`.
- Blank 3D background -> offline or WebGL unavailable (Three.js loads from cdnjs); the rest still works.
- Port in use -> change `PORT` in `.env`.
- Cookies in production need HTTPS (`NODE_ENV=production` sets the Secure flag).

## Package versions
express ^4.19, mysql2 ^3.9, bcryptjs ^2.4, jsonwebtoken ^9, cookie-parser ^1.4, express-rate-limit ^7.2, helmet ^7.1, dotenv ^16.4. Three.js r128 from cdnjs.


