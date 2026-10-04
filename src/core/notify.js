// src/core/notify.js — phone push notifications via ntfy (https://ntfy.sh)
//
// After a sync that finds emails needing a decision you get ONE notification
// ("2 emails need review"). Tapping it opens the review page. Nothing here can
// change a status — confirming still happens on the review page.
//
// Security notes:
//  * ntfy topics are not password-protected: anyone who knows the topic name can
//    read its messages. NTFY_TOPIC=auto derives an unguessable one from
//    REVIEW_KEY. Treat the topic like a password.
//  * The notification never contains REVIEW_KEY; the tap link is plain /review
//    and the page asks for the key once on your phone.
//  * Messages carry company + event type only (no email subjects or bodies).

import env from '../config/env.js';
import detectionRepo from '../repositories/detectionRepo.js';
import { derive } from '../lib/crypto.js';

const EVENT_LABEL = {
  rejection: 'Rejection',
  interview_invite: 'Interview invite',
  phone_screen: 'Phone screen',
  assessment: 'Assessment',
  offer: 'Offer',
  ghosted: 'Ghosted',
  application_received: 'Application received',
  other: 'Email',
};

export const enabled = () => Boolean(env.NTFY_TOPIC);

export const topic = () =>
  env.NTFY_TOPIC === 'auto' ? `jobtrail-mw-${derive('ntfy-topic', 24)}` : env.NTFY_TOPIC;

const MAX_LINES = 5;

export function buildMessage(rows) {
  const n = rows.length;
  const lines = rows.slice(0, MAX_LINES).map(
    (d) => `${d.detected_company || 'Unknown company'} — ${EVENT_LABEL[d.event_type] || 'Email'}`
  );
  if (n > MAX_LINES) lines.push(`+${n - MAX_LINES} more`);
  return {
    title: n === 1 ? 'JobTrail: 1 email needs review' : `JobTrail: ${n} emails need review`,
    message: lines.join('\n'),
  };
}

// ntfy's JSON publish API keeps unicode (em dashes) intact, unlike header-based publishing.
async function publish(fields) {
  const res = await fetch(`${env.NTFY_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: topic(),
      tags: ['incoming_envelope'],
      click: `${env.PUBLIC_URL}/review`,
      ...fields,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ntfy ${res.status}: ${text.slice(0, 160)}`);
  }
}

export async function sendTest() {
  if (!enabled()) throw new Error('Notifications are off — set NTFY_TOPIC=auto on the server');
  await publish({ title: 'JobTrail Mailwatch', message: 'Test notification — phone alerts are working. ✅' });
}

// Notify about every actionable detection not yet announced. `notified_at`
// prevents repeats; if ntfy is unreachable nothing is marked, so the next run retries.
export async function notifyPending({ limit = 20 } = {}) {
  if (!enabled()) return { sent: 0 };
  const rows = await detectionRepo.listUnnotified(limit);
  if (rows.length === 0) return { sent: 0 };

  await publish({ ...buildMessage(rows), priority: 3 });
  await detectionRepo.markNotified(rows.map((r) => r.id));
  return { sent: rows.length };
}
