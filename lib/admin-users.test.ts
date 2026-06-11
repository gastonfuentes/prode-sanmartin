/**
 * Tests for the admin user-management pure helpers.
 *
 * No React, no Supabase — fully testable with Vitest.
 *
 * These two helpers guard the "add user" path: normalizeEmail keeps the input
 * consistent with how handle_new_user (migration 006) and the seed migrations
 * store emails (lowercased), and isValidEmail rejects obviously malformed input
 * before it ever reaches the SECURITY DEFINER RPC.
 */

import { describe, it, expect } from "vitest";
import { normalizeEmail, isValidEmail } from "./admin-users";

// ─── normalizeEmail ──────────────────────────────────────────────────────────

describe("normalizeEmail", () => {
  it("lowercases and trims surrounding whitespace", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });

  it("uppercases the whole address to lowercase", () => {
    expect(normalizeEmail("USER@DOMAIN.COM")).toBe("user@domain.com");
  });

  it("is idempotent for an already-normalized email", () => {
    expect(normalizeEmail("already@lower.com")).toBe("already@lower.com");
  });

  it("preserves the local part except for case (dots, plus tags)", () => {
    expect(normalizeEmail("A.B+Tag@C.com")).toBe("a.b+tag@c.com");
  });
});

// ─── isValidEmail ────────────────────────────────────────────────────────────

describe("isValidEmail", () => {
  it("accepts a standard address", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
  });

  it("accepts an address with surrounding whitespace (trimmed internally)", () => {
    expect(isValidEmail(" person@example.com ")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects a string with no @", () => {
    expect(isValidEmail("nope")).toBe(false);
  });

  it("rejects a domain without a dot", () => {
    expect(isValidEmail("a@b")).toBe(false);
  });

  it("rejects a double @", () => {
    expect(isValidEmail("a@@b.com")).toBe(false);
  });

  it("rejects a space inside the address", () => {
    expect(isValidEmail("a b@c.com")).toBe(false);
  });
});
