/**
 * Tests for Supabase SSR client helpers (TASK-20) and auth utilities
 * (TASK-22/23 helper logic).
 *
 * NOTE on test scope — Strict TDD rationale:
 *   - createBrowserClient / createServerClient are @supabase/ssr wrappers.
 *     The important contract is that OUR helpers call them with the right env
 *     vars and cookie adapters. We verify this via module exports + type shape.
 *   - updateSession (middleware) and the OAuth callback route involve
 *     Next.js Request/Response and Supabase Auth network calls that cannot be
 *     meaningfully unit-tested in Vitest without a full mock rig. Those paths
 *     are covered by TypeScript type-checking + integration smoke verification.
 *   - What IS testable: the pure URL-building logic for the OAuth redirectTo
 *     param, and the whitelist-error mapping logic.
 */

import { describe, it, expect } from "vitest";
import { buildOAuthRedirectUrl, isWhitelistError } from "./auth-utils";

// ─── TASK-22 / TASK-23: OAuth redirect URL builder ──────────────────────────

describe("buildOAuthRedirectUrl", () => {
  it("returns the /auth/callback absolute URL for a clean origin", () => {
    const result = buildOAuthRedirectUrl("https://prode.example.com");
    expect(result).toBe("https://prode.example.com/auth/callback");
  });

  it("strips a trailing slash from the origin before appending the path", () => {
    const result = buildOAuthRedirectUrl("https://prode.example.com/");
    expect(result).toBe("https://prode.example.com/auth/callback");
  });

  it("works for localhost during development", () => {
    const result = buildOAuthRedirectUrl("http://localhost:3000");
    expect(result).toBe("http://localhost:3000/auth/callback");
  });
});

// ─── TASK-23: whitelist error mapping ────────────────────────────────────────

describe("isWhitelistError", () => {
  it("returns true when the error message contains 'not authorized'", () => {
    expect(isWhitelistError(new Error("Email foo@bar.com is not authorized"))).toBe(true);
  });

  it("returns true for access_denied in the error message", () => {
    expect(isWhitelistError(new Error("access_denied: Email not authorized"))).toBe(true);
  });

  it("returns false for unrelated auth errors", () => {
    expect(isWhitelistError(new Error("Invalid login credentials"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isWhitelistError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isWhitelistError(undefined)).toBe(false);
  });

  it("returns false for a non-Error object", () => {
    expect(isWhitelistError({ code: "P0001" })).toBe(false);
  });
});
