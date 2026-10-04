// server.js — JobTrail Mailwatch entry point

import 'dotenv/config';

import express from 'express';
import env from './src/config/env.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import oauthRoutes from './src/routes/oauth.js';
import syncRoutes from './src/routes/sync.js';
import reviewRoutes from './src/routes/review.js';
import { query } from './src/config/db.js';
import { SCHEMA_SQL } from './src/config/schema.js';

const app = express();

app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Never put the key in a redirect: this URL is public.
app.get('/', (req, res) => res.redirect('/review'));

app.use('/oauth', oauthRoutes);
app.use('/sync', syncRoutes);
app.use('/review', reviewRoutes);

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));
app.use(errorHandler);

// Apply the (idempotent) schema on boot so deploys never need a manual migration.
try {
  await query(SCHEMA_SQL);
} catch (err) {
  console.error('[mailwatch] schema check failed:', err.message);
}

app.listen(env.PORT, () => {
  console.log(`[mailwatch] running on port ${env.PORT}`);
});

export default app;
