/**
 * Pure utility functions for OAuth flow and whitelist error detection.
 *
 * These are extracted from the route/component layer so they can be
 * unit-tested without a Next.js runtime or Supabase connection.
 */

// ─── buildOAuthRedirectUrl ───────────────────────────────────────────────────

/**
 * Builds the absolute callback URL for the Google OAuth redirectTo parameter.
 *
 * @param origin - The request origin, e.g. "https://prode.example.com" or
 *                 "http://localhost:3000". A trailing slash is stripped.
 * @returns The full callback URL: "{origin}/auth/callback"
 */
export function buildOAuthRedirectUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/auth/callback`;
}

// ─── isWhitelistError ────────────────────────────────────────────────────────

/**
 * Detects whether an error originated from the email-whitelist DB trigger.
 *
 * The trigger raises:
 *   RAISE EXCEPTION 'Email % is not authorized', NEW.email USING errcode = 'P0001';
 *
 * Supabase surfaces this as an AuthError whose `message` contains
 * "not authorized". We also catch the OAuth-level "access_denied" string
 * that appears when the provider redirects with error=access_denied.
 *
 * REQ-1.3: non-whitelisted users must be redirected without a session.
 */
export function isWhitelistError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("not authorized") || msg.includes("access_denied");
}
