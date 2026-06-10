/**
 * Root Next.js middleware — refreshes the Supabase session cookie on every
 * request so Server Components always receive a valid (non-stale) JWT.
 *
 * Without this, a long-lived tab causes the cookie to expire mid-session,
 * producing random 401s and confusing RSC behaviour.
 *
 * The matcher excludes:
 *   - Static assets under /public
 *   - Next.js internal routes (_next/static, _next/image)
 *   - Favicon
 *
 * Auth callback (/auth/callback) IS intentionally included — the route handler
 * calls exchangeCodeForSession which writes the session cookie; including it
 * here ensures the response cookie from that handler is also forwarded.
 */

import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static   (Next.js static files)
     *   - _next/image    (image optimisation)
     *   - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
};
