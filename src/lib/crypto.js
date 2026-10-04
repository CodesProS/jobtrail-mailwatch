// src/lib/crypto.js — AES-256-GCM encryption for secrets at rest
//
// Stored format:  <iv_hex>:<authtag_hex>:<ciphertext_hex>

import crypto from 'crypto';
import env from '../config/env.js';

const KEY = Buffer.from(env.ENC_KEY, 'hex');
if (KEY.length !== 32) {
  throw new Error('ENC_KEY must be 64 hex characters (32 bytes)');
}

// Constant-time string comparison (for keys, codes, webhook secrets).
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Stable secrets derived from REVIEW_KEY so there is nothing extra to configure.
// Rotating REVIEW_KEY rotates these too (the webhook is re-registered on boot).
export function derive(label, length) {
  return crypto.createHmac('sha256', env.REVIEW_KEY).update(label).digest('hex').slice(0, length);
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(blob) {
  if (!blob) return null;
  const [ivHex, tagHex, dataHex] = blob.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Malformed ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
