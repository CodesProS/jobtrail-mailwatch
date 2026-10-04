// scripts/migrate.js — creates/updates the sidecar's tables.
// The server also runs this schema on boot, so running it by hand is optional.

import 'dotenv/config';
import { query, pool } from '../src/config/db.js';
import { SCHEMA_SQL } from '../src/config/schema.js';

(async () => {
  try {
    console.log('Running mailwatch migration…');
    await query(SCHEMA_SQL);
    console.log('✓ Migration complete');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
