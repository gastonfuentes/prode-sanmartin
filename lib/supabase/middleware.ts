/**
 * Supabase session refresh helper for Next.js middleware.
 *
 * The middleware client MUST use both getAll and setAll so that the auth
 * library can read the current cookie AND write refreshed tokens back to the
 * response headers. Omitting setAll causes stale sessions and random logouts.
 *
 * Pattern from @supabase/ssr docs: "updateSession" wraps the request/response
 * round-trip needed to refresh a potentially-expired JWT before any RSC render.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Start with a passthrough response; the middleware client will mutate its
  // headers to set refreshed session cookies.
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          // Write cookies to BOTH the request (so downstream RSC sees them)
          // and the response (so the browser stores the refreshed token).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run user code between createServerClient and
  // getUser(). A bug here is difficult to debug. getUser() validates the
  // session against the Supabase Auth server; this is what "refreshes" the
  // token if it is near expiry.
  await supabase.auth.getUser();

  return supabaseResponse;
}
