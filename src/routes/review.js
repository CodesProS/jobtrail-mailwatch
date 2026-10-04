// src/routes/review.js — review queue UI + actions + one-time setup

import { Router } from 'express';
import env from '../config/env.js';
import configRepo from '../repositories/configRepo.js';
import detectionRepo from '../repositories/detectionRepo.js';
import { runSync } from '../core/sync.js';
import { saveCredentials, updateJobStatus, listJobs, isConfigured } from '../services/jobtrail.js';
import { safeEqual } from '../lib/crypto.js';
import * as notify from '../core/notify.js';
import { renderPage } from './reviewPage.js';

const router = Router();

const VALID_STATUSES = ['applied', 'phone_screen', 'interview', 'offer', 'rejected', 'ghosted'];

function gate(req, res, next) {
  const key = req.get('X-Review-Key') || req.query.key || req.body?.key;
  if (!safeEqual(key, env.REVIEW_KEY)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ── UI ───────────────────────────────────────────────────────────────────────
// The page holds no data and no secrets. It asks for the key once (or reads
// ?key=), keeps it in the browser, and sends it as a header on every API call.
// That lets the notification tap-link be a plain /review URL.

router.get('/', (req, res) => {
  res.type('html').send(renderPage());
});

// ── Status / data ────────────────────────────────────────────────────────────

router.get('/api/status', gate, async (req, res, next) => {
  try {
    const cfg = await configRepo.get();
    const counts = await detectionRepo.counts();
    res.json({
      gmail_connected: Boolean(cfg?.gmail_refresh_token_enc),
      gmail_email: cfg?.gmail_email || null,
      jobtrail_connected: await isConfigured(),
      jobtrail_email: cfg?.jobtrail_email || null,
      last_sync_at: cfg?.last_sync_at || null,
      last_sync_summary: cfg?.last_sync_summary || null,
      counts,
      notifications: notify.enabled()
        ? { enabled: true, topic: notify.topic(), server: env.NTFY_URL }
        : { enabled: false },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/detections', gate, async (req, res, next) => {
  try {
    const state = req.query.state || null;
    const rows = await detectionRepo.list({ state, limit: 200 });
    res.json({ detections: rows });
  } catch (err) {
    next(err);
  }
});

// Job list for the manual-match dropdown.
router.get('/api/jobs', gate, async (req, res, next) => {
  try {
    if (!(await isConfigured())) return res.json({ jobs: [] });
    const jobs = await listJobs();
    res.json({
      jobs: jobs.map((j) => ({ id: j.id, label: `${j.company} — ${j.role}`, status: j.status })),
    });
  } catch (err) {
    next(err);
  }
});

// ── Actions ──────────────────────────────────────────────────────────────────

router.post('/api/sync', gate, async (req, res, next) => {
  try {
    const result = await runSync({ trigger: 'manual' });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/api/notify-test', gate, async (req, res, next) => {
  try {
    await notify.sendTest();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Confirm: push the status to JobTrail, mark detection applied.
router.post('/api/detections/:id/confirm', gate, async (req, res, next) => {
  try {
    const det = await detectionRepo.findById(req.params.id);
    if (!det) return res.status(404).json({ error: 'detection not found' });
    if (det.state === 'applied') return res.status(409).json({ error: 'already applied' });

    const jobId = Number(req.body.job_id || det.matched_job_id);
    const status = String(req.body.status || det.proposed_status || '');
    if (!jobId) return res.status(400).json({ error: 'job_id required' });
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const job = await updateJobStatus(jobId, status);
    const label = job?.company ? `${job.company} — ${job.role}` : `job #${jobId}`;
    const updated = await detectionRepo.resolve(det.id, {
      state: 'applied',
      matched_job_id: jobId,
      matched_job_label: label,
      note: `set to "${status}" in JobTrail`,
    });
    res.json({ ok: true, detection: updated, job });
  } catch (err) {
    next(err);
  }
});

router.post('/api/detections/:id/dismiss', gate, async (req, res, next) => {
  try {
    const det = await detectionRepo.findById(req.params.id);
    if (!det) return res.status(404).json({ error: 'detection not found' });
    const updated = await detectionRepo.resolve(det.id, { state: 'dismissed', note: req.body.note || 'dismissed' });
    res.json({ ok: true, detection: updated });
  } catch (err) {
    next(err);
  }
});

// ── One-time setup: store JobTrail credentials ───────────────────────────────

router.post('/setup/jobtrail', gate, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const out = await saveCredentials(email.toLowerCase().trim(), password);
    res.json({ ok: true, ...out });
  } catch (err) {
    // Surface the real reason (bad password, JobTrail down, DB error) — this
    // route is gated by REVIEW_KEY, and the generic 500 hides what to fix.
    console.error('[setup/jobtrail]', err.stack || err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
