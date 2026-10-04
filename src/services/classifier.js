// src/services/classifier.js — Groq classification of a single job-related email

import env from '../config/env.js';

// event_type -> JobTrail status. null means "no status change implied".
export const STATUS_MAP = {
  application_received: null,        // just an acknowledgement
  rejection: 'rejected',
  ghosted: 'ghosted',
  assessment: 'phone_screen',       // online assessment / take-home
  phone_screen: 'phone_screen',
  interview_invite: 'interview',
  offer: 'offer',
  other: null,
};

// Rank for the "only move forward" guard. Terminal states bypass it.
export const STATUS_RANK = { applied: 0, phone_screen: 1, interview: 2, offer: 3 };
export const TERMINAL = new Set(['rejected', 'ghosted']);

const SYSTEM_PROMPT = `You classify a single email that may relate to a job application. Return ONLY a valid JSON object with these exact keys:

{
  "is_job_related": true,
  "company": "Hiring company name (empty string if unclear)",
  "role": "Job title referenced (empty string if unclear)",
  "event_type": "one of: application_received, rejection, interview_invite, phone_screen, assessment, offer, ghosted, other",
  "confidence": 0.0
}

Definitions:
- application_received: automated 'we got your application' acknowledgement.
- rejection: they are not moving forward.
- interview_invite: invitation to an interview (onsite, virtual, panel, hiring manager).
- phone_screen: invitation to an initial recruiter/phone screen specifically.
- assessment: coding test, take-home, or online assessment request.
- offer: a job offer is being extended.
- other: recruiter cold outreach, newsletters, networking, scheduling logistics for an already-known step, or anything not above.

Rules:
- Return ONLY the JSON object. No markdown, no code fences, no commentary.
- is_job_related is false for newsletters, marketing, receipts, and generic recruiter spam not tied to an application the person made.
- confidence is your certainty in event_type, 0.0 to 1.0.
- If is_job_related is false, set event_type to "other" and confidence to 0.0.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Errors worth retrying later (rate limit, 5xx, network) are flagged so the
// sync can defer the email instead of recording a permanent failure.
function transientError(message) {
  const err = new Error(message);
  err.transient = true;
  return err;
}

// Groq says "Please try again in 5.52s" and/or sends a Retry-After header.
function retryWaitMs(res, message) {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000) + 250;
  const m = /try again in ([\d.]+)\s*(ms|s)/i.exec(message || '');
  if (m) return Math.ceil(m[2].toLowerCase() === 'ms' ? Number(m[1]) : Number(m[1]) * 1000) + 500;
  return 5000;
}

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 15000; // never hold a request longer than this for one retry

async function callGroq(payload) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: payload,
      });
    } catch (err) {
      throw transientError(`Groq network error: ${err.message}`);
    }

    const data = await res.json().catch(() => ({}));
    if (res.ok && !data.error) return data;

    const message = data.error?.message || `Groq HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) {
      const wait = retryWaitMs(res, message);
      if (attempt < MAX_RETRIES && wait <= MAX_WAIT_MS) {
        await sleep(wait);
        continue;
      }
      throw transientError(message);
    }
    throw new Error(message);
  }
}

export async function classifyEmail({ fromName, from, subject, body }) {
  const userMsg =
    `From: ${fromName} <${from}>\n` +
    `Subject: ${subject}\n\n` +
    `--- EMAIL BODY ---\n${(body || '').slice(0, 1500)}`;

  const payload = JSON.stringify({
    model: env.GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    max_tokens: 512,
    temperature: 0.1,
  });

  const data = await callGroq(payload);

  const content = data.choices?.[0]?.message?.content || '';
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/g, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Groq returned non-JSON: ' + content.slice(0, 200));

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('Groq returned non-JSON: ' + content.slice(0, 200));
  }

  const eventType = STATUS_MAP.hasOwnProperty(parsed.event_type) ? parsed.event_type : 'other';
  return {
    is_job_related: parsed.is_job_related === true,
    company: (parsed.company || '').trim(),
    role: (parsed.role || '').trim(),
    event_type: eventType,
    confidence: clamp01(Number(parsed.confidence)),
    proposed_status: STATUS_MAP[eventType] || null,
  };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
