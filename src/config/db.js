// src/config/db.js — PostgreSQL pool (pg)

import pg from 'pg';
import env from './env.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (env.NODE_ENV !== 'production') {
    console.debug(`[DB] ${text.slice(0, 60).replace(/\s+/g, ' ')}… (${Date.now() - start}ms)`);
  }
  return res;
}

export { pool };
