import { normalizeEmail } from './crypto.js';

export function isAdminEmail(email, adminEmail) {
  if (!email || !adminEmail) return false;
  return normalizeEmail(email) === normalizeEmail(adminEmail);
}

export function serializeAuthenticatedUser(user, adminEmail) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.emailVerified ?? user.emailVerifiedAt),
    isAdmin: isAdminEmail(user.email, adminEmail),
  };
}
