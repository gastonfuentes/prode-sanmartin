/**
 * Supabase browser client — use in Client Components only.
 *
 * Uses @supabase/ssr createBrowserClient which manages the session cookie
 * via the browser's document.cookie (getAll/setAll pattern, v0.6+).
 *
 * Do NOT import this in Server Components or route handlers — use server.ts.
 */

import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
