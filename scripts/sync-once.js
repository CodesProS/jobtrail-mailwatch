// scripts/sync-once.js — run one sync pass from the CLI (local debugging)

import 'dotenv/config';
import { runSync } from '../src/core/sync.js';
import { pool } from '../src/config/db.js';

(async () => {
  try {
    const result = await runSync({ trigger: 'cli' });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error('sync failed:', err.stack || err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
