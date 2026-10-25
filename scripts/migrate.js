'use strict';
require('dotenv').config();
const fs = require('fs'), path = require('path'), mysql = require('mysql2/promise');
(async () => {
  const name = process.env.DB_NAME || 'risk_engine';
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('DB_NAME may only contain letters, digits, underscore');
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
  await c.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4`);
  await c.query(`USE \`${name}\``);
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set((await c.query('SELECT name FROM schema_migrations'))[0].map(r => r.name));
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) { console.log('skip', f); continue; }
    await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await c.query('INSERT INTO schema_migrations(name) VALUES (?)', [f]);
    console.log('applied', f);
  }
  await c.end();
  console.log('Migrations complete.');
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
