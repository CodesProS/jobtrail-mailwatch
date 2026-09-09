// src/services/gmail.js — Gmail OAuth + read-only message access (raw REST, no SDK)

import env from '../config/env.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ── OAuth ────────────────────────────────────────────────────────────────────

export function consentUrl(state) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',           // force a refresh_token every time
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH}?${p.toString()}`;
}

export async function exchangeCode(code) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${data.error_description || data.error || res.status}`);
  return data; // { access_token, refresh_token, expires_in, ... }
}

export async function accessTokenFromRefresh(refreshToken) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Google refresh failed: ${data.error_description || data.error || res.status}`);
    err.code = data.error; // 'invalid_grant' => user revoked access
    throw err;
  }
  return data.access_token;
}

export async function getProfile(accessToken) {
  const res = await fetch(`${API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail profile failed: ${data.error?.message || res.status}`);
  return data; // { emailAddress, ... }
}

// ── Messages ─────────────────────────────────────────────────────────────────

// Returns up to `max` message ids matching `q`, newest first.
export async function listMessageIds(accessToken, q, max = 40) {
  const ids = [];
  let pageToken;
  do {
    const p = new URLSearchParams({ q, maxResults: '50' });
    if (pageToken) p.set('pageToken', pageToken);
    const res = await fetch(`${API}/messages?${p.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Gmail list failed: ${data.error?.message || res.status}`);
    for (const m of data.messages || []) ids.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

export async function getMessage(accessToken, id) {
  const res = await fetch(`${API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail get failed: ${data.error?.message || res.status}`);
  return parseMessage(data);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function header(payload, name) {
  const h = (payload.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// Walk the MIME tree, prefer text/plain, fall back to stripped text/html.
function extractBody(payload) {
  let plain = '';
  let html = '';
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body?.data) plain += b64urlDecode(part.body.data);
    else if (mime === 'text/html' && part.body?.data) html += b64urlDecode(part.body.data);
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);
  if (plain.trim()) return plain;
  if (html.trim()) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function parseMessage(msg) {
  const payload = msg.payload || {};
  const from = header(payload, 'From');
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s<]+@[^\s>]+)/);
  const fromAddr = emailMatch ? emailMatch[1].toLowerCase() : '';
  const fromDomain = fromAddr.includes('@') ? fromAddr.split('@')[1] : '';

  // Strip quoted reply history to keep the LLM focused on the newest content.
  let body = extractBody(payload);
  body = body.split(/\nOn .+ wrote:\n/)[0].split(/\n-{2,} ?Forwarded message ?-{2,}/i)[0];

  return {
    id: msg.id,
    threadId: msg.threadId,
    internalDate: Number(msg.internalDate || 0), // ms
    from: fromAddr,
    fromDomain,
    fromName: from.replace(/<[^>]+>/, '').replace(/"/g, '').trim(),
    subject: header(payload, 'Subject'),
    snippet: msg.snippet || '',
    body: body.slice(0, 4000),
  };
}
