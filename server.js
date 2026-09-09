// server.js — JobTrail Mailwatch entry point

import 'dotenv/config';

import express from 'express';
import env from './src/config/env.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import oauthRoutes from './src/routes/oauth.js';
import syncRoutes from './src/routes/sync.js';
import reviewRoutes from './src/routes/review.js';

const app = express();

app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.get('/', (req, res) => res.redirect(`/review?key=${encodeURIComponent(env.REVIEW_KEY)}`));

app.use('/oauth', oauthRoutes);
app.use('/sync', syncRoutes);
app.use('/review', reviewRoutes);

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`[mailwatch] running on port ${env.PORT}`);
});

export default app;
