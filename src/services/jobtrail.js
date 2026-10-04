// src/services/jobtrail.js — thin client for the JobTrail public API
//
// JobTrail issues 7-day JWTs from POST /auth/login. We store the user's
// JobTrail credentials encrypted and mint a fresh token when the cached one
// is within a day of expiry.

import env from '../config/env.js';
import configRepo from '../repositories/configRepo.js';
import { encrypt, decrypt } from '../lib/crypto.js';

const BASE = env.JOBTRAIL_API_URL;

function jwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

// POST /auth/login with retry on 429 (rate limiting seen from Render's network).
// Logs response headers on failure so we can tell which layer answered.
async function login(email, password) {
  const delays = [2000, 5000, 10000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { /* non-JSON body */ }

    if (res.ok && data.token) return data;

    if (res.status === 429 && attempt < delays.length) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15000) : delays[attempt];
      console.warn(`[jobtrail] login 429, retrying in ${wait}ms (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    console.error(
      `[jobtrail] login failed: ${res.status} server=${res.headers.get('server')} ` +
      `retry-after=${res.headers.get('retry-after')} cf-ray=${res.headers.get('cf-ray')} body=${raw.slice(0, 200)}`
    );
    throw new Error(data.error || `JobTrail login failed (${res.status})${res.status === 429 ? ' — rate limited, try again in a few minutes' : ''}`);
  }
}

export async function saveCredentials(email, password) {
  // Verify they work before storing.
  const data = await login(email, password);
  await configRepo.update({
    jobtrail_email: email,
    jobtrail_password_enc: encrypt(password),
    jobtrail_token_cache: data.token,
    jobtrail_token_exp: jwtExp(data.token),
  });
  return { email };
}

async function getToken() {
  const cfg = await configRepo.get();
  if (!cfg?.jobtrail_password_enc) throw new Error('JobTrail credentials not set — POST /setup/jobtrail first');

  const now = Math.floor(Date.now() / 1000);
  if (cfg.jobtrail_token_cache && Number(cfg.jobtrail_token_exp) - now > 86400) {
    return cfg.jobtrail_token_cache;
  }

  const data = await login(cfg.jobtrail_email, decrypt(cfg.jobtrail_password_enc));

  await configRepo.update({ jobtrail_token_cache: data.token, jobtrail_token_exp: jwtExp(data.token) });
  return data.token;
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `JobTrail ${options.method || 'GET'} ${path} -> ${res.status}`);
  return data;
}

export async function listJobs() {
  const data = await apiFetch('/jobs');
  return data.jobs || [];
}

export async function updateJobStatus(id, status) {
  const data = await apiFetch(`/jobs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return data.job || data;
}

export async function isConfigured() {
  const cfg = await configRepo.get();
  return Boolean(cfg?.jobtrail_password_enc);
}
