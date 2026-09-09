// src/routes/sync.js — POST /sync, triggered by the GitHub Actions cron

import { Router } from 'express';
import env from '../config/env.js';
import { runSync } from '../core/sync.js';

const router = Router();

let running = false;

// POST /sync   header: X-Sync-Secret: <SYNC_SECRET>   (or ?key= for manual use)
router.post('/', async (req, res, next) => {
  const provided = req.get('X-Sync-Secret') || req.query.key;
  if (provided !== env.SYNC_SECRET && provided !== env.REVIEW_KEY) {
    return res.status(401).json({ error: 'bad secret' });
  }
  if (running) return res.status(409).json({ error: 'sync already running' });

  running = true;
  try {
    const result = await runSync({ trigger: 'cron' });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    next(err);
  } finally {
    running = false;
  }
});

export default router;
