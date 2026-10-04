// src/repositories/detectionRepo.js — mw_detections CRUD

import { query } from '../config/db.js';

const detectionRepo = {
  async existingIds(gmailMsgIds) {
    if (gmailMsgIds.length === 0) return new Set();
    const res = await query(
      'SELECT gmail_msg_id FROM mw_detections WHERE gmail_msg_id = ANY($1)',
      [gmailMsgIds]
    );
    return new Set(res.rows.map((r) => r.gmail_msg_id));
  },

  // Earlier versions stored Groq rate-limit failures as permanent 'error' rows,
  // which hid those emails from every future sync. Remove them so they retry.
  async deleteRateLimitErrors() {
    const res = await query(
      `DELETE FROM mw_detections WHERE state = 'error' AND note ILIKE 'rate limit%'`
    );
    return res.rowCount;
  },

  async insert(d) {
    const res = await query(
      `INSERT INTO mw_detections
         (gmail_msg_id, gmail_thread_id, from_addr, from_domain, subject, snippet, received_at,
          is_job_related, detected_company, detected_role, event_type, proposed_status,
          llm_confidence, llm_json, matched_job_id, matched_job_label, match_score, match_margin,
          candidates_json, state, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (gmail_msg_id) DO NOTHING
       RETURNING *`,
      [
        d.gmail_msg_id, d.gmail_thread_id || null, d.from_addr || null, d.from_domain || null,
        d.subject || null, d.snippet || null, d.received_at || null,
        d.is_job_related ?? null, d.detected_company || null, d.detected_role || null,
        d.event_type || null, d.proposed_status || null,
        d.llm_confidence ?? null, d.llm_json ? JSON.stringify(d.llm_json) : null,
        d.matched_job_id || null, d.matched_job_label || null,
        d.match_score ?? null, d.match_margin ?? null,
        d.candidates_json ? JSON.stringify(d.candidates_json) : null,
        d.state || 'pending', d.note || null,
      ]
    );
    return res.rows[0] || null;
  },

  async findById(id) {
    const res = await query('SELECT * FROM mw_detections WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  },

  async list({ state, limit = 100 } = {}) {
    if (state) {
      const res = await query(
        'SELECT * FROM mw_detections WHERE state = $1 ORDER BY received_at DESC NULLS LAST, id DESC LIMIT $2',
        [state, limit]
      );
      return res.rows;
    }
    const res = await query(
      'SELECT * FROM mw_detections ORDER BY received_at DESC NULLS LAST, id DESC LIMIT $1',
      [limit]
    );
    return res.rows;
  },

  async resolve(id, { state, note, matched_job_id, matched_job_label }) {
    const res = await query(
      `UPDATE mw_detections
         SET state = $2,
             note = COALESCE($3, note),
             matched_job_id = COALESCE($4, matched_job_id),
             matched_job_label = COALESCE($5, matched_job_label),
             resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, state, note ?? null, matched_job_id ?? null, matched_job_label ?? null]
    );
    return res.rows[0] || null;
  },

  async counts() {
    const res = await query(
      `SELECT state, COUNT(*)::int AS n FROM mw_detections GROUP BY state`
    );
    return Object.fromEntries(res.rows.map((r) => [r.state, r.n]));
  },
};

export default detectionRepo;
