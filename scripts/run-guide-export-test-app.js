// Local verification only. No dotenv, real users, or database connections.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const fixturePath = process.env.DORM_GUIDE_FIXTURE;
if (!fixturePath) throw new Error('DORM_GUIDE_FIXTURE is required');
const rows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
process.env.PREVIEW_DATABASE_URL = 'mysql://fixture:fixture@127.0.0.1/fixture';
process.env.PREVIEW_GATEWAY_TOKENS = 'fixture:' + crypto.createHash('sha256').update('local-guide-fixture-token').digest('hex');
process.env.PREVIEW_ALLOWED_ORIGINS = 'http://localhost:5173';
const mysql = require.resolve('mysql2/promise');
require(mysql);
require.cache[mysql].exports = { createPool: () => ({ execute: async sql => {
  if (!/^SELECT\b/.test(sql.trim()) || /\b(UPDATE|INSERT|DELETE)\b/i.test(sql)) throw new Error('Only SELECT allowed');
  return [rows];
} }) };
const app = express();
app.use('/api/preview', require('../routes/preview'));
app.listen(18767, '127.0.0.1');
