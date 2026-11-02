'use strict';
const mysql = require('mysql2/promise');
module.exports = mysql.createPool({
  host: process.env.DB_HOST, port: +process.env.DB_PORT || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  waitForConnections: true, connectionLimit: 10, dateStrings: true
});