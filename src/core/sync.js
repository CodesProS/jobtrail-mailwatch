// src/core/sync.js — the pipeline: Gmail -> classify -> match -> store detections
//
// This NEVER writes to JobTrail. It only produces rows in mw_detections that
// you approve from the /review page.
//
// Rate-limit behaviour: at most LLM_PER_RUN AI calls happen per run. Anything
// beyond that, or anything the AI provider rate-limits, is *deferred*: no row is
// written, the watermark is held back, and the next run picks it up.

import env from '../config/env.js';
import configRepo from '../repositories/configRepo.js';
import detectionRepo from '../repositories/detectionRepo.js';
import { decrypt } from '../lib/crypto.js';
import { accessTokenFromRefresh, listMessageIds, getMessage } from '../services/gmail.js';
import { classifyEmail, STATUS_RANK, TERMINAL } from '../services/classifier.js';
import { matchEmailToJobs } from '../services/matcher.js';
import { listJobs, isConfigured } from '../services/jobtrail.js';
import { notifyPending } from './notify.js';

// Cheap gate so we don't spend an LLM call on obvious non-job mail.
const JOB_HINTS = /(applic|interview|recruit|screen|assessment|coding challenge|take[- ]home|hiring|candidate|position|role|offer|unfortunately|regret to inform|not moving forward|talent|hiring team|next steps|schedule a (call|time))/i;

// Each run scans only mail received after the previous successful run began
// (mw_config.last_message_ts). A 60s overlap absorbs clock skew between this
// server and Gmail; UNIQUE(gmail_msg_id) makes the overlap harmless.
const OVERLAP_SEC = 60;

let running = false;

function senderIgnored(msg) {
  const hay = `${msg.from} ${msg.fromDomain}`.toLowerCase();
  return env.IGNORE_SENDERS.some((s) => hay.includes(s));
}

export async function runSync({ trigger = 'manual' } = {}) {
  if (running) return { ok: false, error: 'A sync is already running — try again in a minute.' };
  running = true;
  try {
    return await doSync(trigger);
  } finally {
    running = false;
  }
}

async function doSync(trigger) {
  const started = Date.now();
  const startedAtMs = started;
  const cfg = await configRepo.get();

  if (!cfg?.gmail_refresh_token_enc) {
    return { ok: false, error: 'Gmail not connected. Visit /oauth/start.' };
  }
  if (!(await isConfigured())) {
    return { ok: false, error: 'JobTrail credentials not set. POST /setup/jobtrail.' };
  }

  // First ever run: don't read history. Start the clock now; only mail that
  // arrives from this moment on is scanned.
  const storedSec = Number(cfg.last_message_ts || 0);
  if (!storedSec) {
    const nowSec = Math.floor(startedAtMs / 1000);
    const summary = `${new Date(startedAtMs).toISOString()} · baseline set, scanning mail received from now on`;
    await configRepo.update({ last_message_ts: nowSec, last_sync_at: new Date(startedAtMs).toISOString(), last_sync_summary: summary });
    return { ok: true, baseline: true, ms: Date.now() - started, trigger, scanned: 0, new: 0, pending: 0, no_match: 0, ignored: 0, errors: 0, deferred: 0 };
  }

  let accessToken;
  try {
    accessToken = await accessTokenFromRefresh(decrypt(cfg.gmail_refresh_token_enc));
  } catch (err) {
    if (err.code === 'invalid_grant') {
      await configRepo.update({
        gmail_refresh_token_enc: null,
        gmail_connected_at: null,
        last_sync_summary: 'Gmail access revoked — reconnect at /oauth/start',
      });
      return { ok: false, error: 'Gmail access was revoked. Reconnect at /oauth/start.' };
    }
    throw err;
  }

  // Clean-up: earlier versions stored Groq rate-limit failures as permanent
  // 'error' rows (no subject). They are old mail we no longer rescan; drop them.
  const healed = await detectionRepo.deleteRateLimitErrors();
  if (healed > 0) console.log(`[sync] removed ${healed} stale rate-limit error rows`);

  const q = `${env.GMAIL_QUERY} after:${storedSec - OVERLAP_SEC}`;

  const ids = await listMessageIds(accessToken, q, 60);
  const known = await detectionRepo.existingIds(ids);
  // Gmail lists newest first; work oldest-first so the watermark can advance
  // monotonically and a deferral only ever leaves *newer* mail behind.
  const fresh = ids.filter((id) => !known.has(id)).reverse();

  const stats = { trigger, scanned: ids.length, new: fresh.length, pending: 0, no_match: 0, ignored: 0, errors: 0, deferred: 0 };
  let jobsCache = null;
  let llmCalls = 0;
  let blocked = false;                                  // true once something was deferred
  let watermarkMs = storedSec * 1000;                   // only used if the run is cut short
  const advance = (msg) => {
    if (!blocked && msg.internalDate) watermarkMs = Math.max(watermarkMs, msg.internalDate);
  };

  for (let i = 0; i < fresh.length; i++) {
    const id = fresh[i];
    let base = { gmail_msg_id: id };
    try {
      const msg = await getMessage(accessToken, id);
      base = {
        gmail_msg_id: msg.id,
        gmail_thread_id: msg.threadId,
        from_addr: msg.from,
        from_domain: msg.fromDomain,
        subject: msg.subject,
        snippet: msg.snippet,
        received_at: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
      };

      if (senderIgnored(msg)) {
        await detectionRepo.insert({ ...base, is_job_related: false, state: 'ignored', note: 'sender on ignore list' });
        stats.ignored++;
        advance(msg);
        continue;
      }

      const hintText = `${msg.subject} ${msg.snippet} ${msg.body.slice(0, 400)}`;
      if (!JOB_HINTS.test(hintText)) {
        await detectionRepo.insert({ ...base, is_job_related: false, state: 'ignored', note: 'prefilter: no job keywords' });
        stats.ignored++;
        advance(msg);
        continue;
      }

      if (llmCalls >= env.LLM_PER_RUN) {
        stats.deferred++;
        blocked = true;
        continue;
      }
      llmCalls++;
      const cls = await classifyEmail(msg);

      if (!cls.is_job_related || cls.event_type === 'other') {
        await detectionRepo.insert({
          ...base, is_job_related: cls.is_job_related, event_type: cls.event_type,
          detected_company: cls.company, detected_role: cls.role,
          llm_confidence: cls.confidence, llm_json: cls, state: 'ignored',
          note: 'classified as not actionable',
        });
        stats.ignored++;
        advance(msg);
        continue;
      }

      if (!jobsCache) jobsCache = await listJobs();
      const { best, margin, candidates } = matchEmailToJobs(
        { company: cls.company, role: cls.role, fromDomain: msg.fromDomain },
        jobsCache
      );

      // "Only move forward" guidance (does not block — you still confirm).
      const proposed = cls.proposed_status;
      let note = null;
      if (best && proposed && !TERMINAL.has(proposed)) {
        const cur = STATUS_RANK[best.status];
        const next = STATUS_RANK[proposed];
        if (cur !== undefined && next !== undefined && next <= cur) {
          note = `email implies "${proposed}" but "${best.label}" is already at "${best.status}"`;
        }
      }

      const matched = best && best.score >= 0.3;
      await detectionRepo.insert({
        ...base,
        is_job_related: true,
        detected_company: cls.company,
        detected_role: cls.role,
        event_type: cls.event_type,
        proposed_status: proposed,
        llm_confidence: cls.confidence,
        llm_json: cls,
        matched_job_id: matched ? best.id : null,
        matched_job_label: matched ? best.label : null,
        match_score: best ? best.score : null,
        match_margin: margin,
        candidates_json: candidates,
        state: matched ? 'pending' : 'no_match',
        note,
      });
      if (matched) stats.pending++;
      else stats.no_match++;
      advance({ internalDate: base.received_at ? Date.parse(base.received_at) : 0 });
    } catch (err) {
      if (err.transient) {
        // Rate limit / provider outage: stop spending calls, leave the rest for
        // the next run. Nothing is written, so these emails are retried.
        console.warn(`[sync] deferring ${fresh.length - i} message(s): ${err.message.slice(0, 160)}`);
        stats.deferred += fresh.length - i;
        blocked = true;
        break;
      }
      console.error(`[sync] message ${id} failed:`, err.message);
      await detectionRepo.insert({ ...base, state: 'error', note: err.message.slice(0, 300) });
      stats.errors++;
    }
  }

  // Clean run  -> next scan starts when THIS run began.
  // Cut short  -> next scan resumes at the last message fully handled, so the
  //               deferred (newer) mail is picked up.
  const nextSinceMs = blocked ? watermarkMs : startedAtMs;
  await configRepo.update({
    last_message_ts: Math.floor(nextSinceMs / 1000),
    last_sync_at: new Date().toISOString(),
    last_sync_summary: `${new Date().toISOString()} · ${JSON.stringify(stats)}`,
  });

  // Phone push (ntfy) for anything new; no-op unless NTFY_TOPIC is set.
  // A notification failure must never fail the sync.
  try {
    stats.notified = (await notifyPending()).sent;
  } catch (err) {
    console.error('[sync] notify failed:', err.message);
  }

  return { ok: true, ms: Date.now() - started, ...stats };
}
