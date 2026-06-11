/**
 * Pure helpers for admin user management.
 *
 * No React, no Supabase — fully testable with Vitest.
 *
 * The whitelist (allowed_emails) and the handle_new_user trigger (migration 006)
 * compare on lowercased emails. normalizeEmail keeps the dashboard input aligned
 * with that convention; isValidEmail is a pragmatic shape check (this is a closed
 * pool of friends, not a public signup) so we reject obvious typos before hitting
 * the SECURITY DEFINER RPC.
 */

/** Lowercases and trims an email; matches the DB whitelist compare (lower(...)). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Basic email-shape check: a single @, non-empty local and domain parts, and at
 * least one dot in the domain. Intentionally simple — not RFC-complete.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
