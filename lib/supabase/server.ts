/**
 * Supabase server client — use in Server Components, route handlers, and
 * server actions.
 *
 * Uses @supabase/ssr createServerClient with the Next.js 15 cookies() API
 * (getAll/setAll pattern — the v0.6 non-deprecated interface).
 *
 * cookies() in Next.js 15 is async; we await it once per request and pass the
 * resolved cookie store to the adapter.
 *
 * Do NOT import this in Client Components — use client.ts.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll called from a Server Component — cookies are read-only in
            // that context. The middleware handles session refresh, so this is
            // safe to ignore here. See middleware.ts.
          }
        },
      },
    }
  );
}
