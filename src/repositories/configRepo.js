// src/repositories/configRepo.js — the single mw_config row

import { query } from '../config/db.js';

const configRepo = {
  async get() {
    const res = await query('SELECT * FROM mw_config WHERE id = 1 LIMIT 1');
    return res.rows[0] || null;
  },

  async update(fields) {
    const allowed = [
      'jobtrail_email', 'jobtrail_password_enc', 'jobtrail_token_cache', 'jobtrail_token_exp',
      'gmail_email', 'gmail_refresh_token_enc', 'gmail_connected_at',
      'last_message_ts', 'last_sync_at', 'last_sync_summary',
    ];
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        setClauses.push(`${key} = $${idx}`);
        values.push(fields[key]);
        idx++;
      }
    }
    if (setClauses.length === 0) return this.get();

    const res = await query(
      `UPDATE mw_config SET ${setClauses.join(', ')} WHERE id = 1 RETURNING *`,
      values
    );
    return res.rows[0];
  },
};

export default configRepo;
