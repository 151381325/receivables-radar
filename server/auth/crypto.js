import { createHash } from 'node:crypto';

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

export function hashOpaqueToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}
