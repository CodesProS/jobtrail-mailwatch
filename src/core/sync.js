// src/core/sync.js — the pipeline: Gmail -> classify -> match -> store detections
//
// This NEVER writes to JobTrail. It only produces rows in mw_detections that
// you approve from the /review page.

import env from '../config/env.js';
import configRepo from '../repositories/configRepo.js';
import detectionRepo from '../repositories/detectionRepo.js';
import { decrypt } from '../lib/crypto.js';
import { accessTokenFromRefresh, listMessageIds, getMessage } from '../services/gmail.js';
import { classifyEmail, STATUS_RANK, TERMINAL } from '../services/classifier.js';
import { matchEmailToJobs } from '../services/matcher.js';
import { listJobs, isConfigured } from '../services/jobtrail.js';

// Cheap gate so we don't spend an LLM call on obvious non-job mail.
const JOB_HINTS = /(applic|interview|recruit|screen|assessment|coding challenge|take[- ]home|hiring|candidate|position|role|offer|unfortunately|regret to inform|not moving forward|talent|hiring team|next steps|schedule a (call|time))/i;

const SAFETY_WINDOW_SEC = 2 * 24 * 60 * 60; // re-scan a 2-day overlap; UNIQUE(gmail_msg_id) dedupes

export async function runSync({ trigger = 'manual' } = {}) {
  const started = Date.now();
  const cfg = await configRepo.get();

  if (!cfg?.gmail_refresh_token_enc) {
    return { ok: false, error: 'Gmail not connected. Visit /oauth/start.' };
  }
  if (!(await isConfigured())) {
    return { ok: false, error: 'JobTrail credentials not set. POST /setup/jobtrail.' };
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

  const sinceSec = Math.max(0, Number(cfg.last_message_ts || 0) - SAFETY_WINDOW_SEC);
  const q = sinceSec > 0 ? `${env.GMAIL_QUERY} after:${sinceSec}` : env.GMAIL_QUERY;

  const ids = await listMessageIds(accessToken, q, 60);
  const known = await detectionRepo.existingIds(ids);
  const fresh = ids.filter((id) => !known.has(id));

  const stats = { trigger, scanned: ids.length, new: fresh.length, pending: 0, no_match: 0, ignored: 0, errors: 0 };
  let jobsCache = null;
  let maxInternalMs = Number(cfg.last_message_ts || 0) * 1000;

  for (const id of fresh) {
    try {
      const msg = await getMessage(accessToken, id);
      maxInternalMs = Math.max(maxInternalMs, msg.internalDate);

      const base = {
        gmail_msg_id: msg.id,
        gmail_thread_id: msg.threadId,
        from_addr: msg.from,
        from_domain: msg.fromDomain,
        subject: msg.subject,
        snippet: msg.snippet,
        received_at: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
      };

      const hintText = `${msg.subject} ${msg.snippet} ${msg.body.slice(0, 400)}`;
      if (!JOB_HINTS.test(hintText)) {
        await detectionRepo.insert({ ...base, is_job_related: false, state: 'ignored', note: 'prefilter: no job keywords' });
        stats.ignored++;
        continue;
      }

      const cls = await classifyEmail(msg);

      if (!cls.is_job_related || cls.event_type === 'other') {
        await detectionRepo.insert({
          ...base, is_job_related: cls.is_job_related, event_type: cls.event_type,
          detected_company: cls.company, detected_role: cls.role,
          llm_confidence: cls.confidence, llm_json: cls, state: 'ignored',
          note: 'classified as not actionable',
        });
        stats.ignored++;
        continue;
      }

      if (!jobsCache) jobsCache = await listJobs();
      const { best, margin, candidates } = matchEmailToJobs(
        { company: cls.company, role: cls.role, fromDomain: msg.fromDomain },
        jobsCache
      );

      // "Only move forward" guidance (does not block — you still confirm).
      let proposed = cls.proposed_status;
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
    } catch (err) {
      console.error(`[sync] message ${id} failed:`, err.message);
      await detectionRepo.insert({
        gmail_msg_id: id, state: 'error', note: err.message.slice(0, 300),
      });
      stats.errors++;
    }
  }

  const newWatermark = Math.floor(maxInternalMs / 1000);
  await configRepo.update({
    last_message_ts: newWatermark || cfg.last_message_ts,
    last_sync_at: new Date().toISOString(),
    last_sync_summary: `${new Date().toISOString()} · ${JSON.stringify(stats)}`,
  });

  return { ok: true, ms: Date.now() - started, ...stats };
}
