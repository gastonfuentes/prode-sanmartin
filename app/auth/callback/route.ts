/**
 * OAuth callback route — exchanges the authorization code for a session.
 *
 * Flow:
 *   1. Google redirects here with ?code=... (or ?error=access_denied).
 *   2. We call exchangeCodeForSession() which writes the session cookie.
 *      If the user's email is not in the whitelist, the DB trigger raises an
 *      exception; Supabase surfaces it as an AuthError.
 *   3. On success → redirect to / (app home, which redirects to current round).
 *   4. On whitelist error or any auth failure → redirect to /login?error=access_denied.
 *
 * REQ-1.3: non-whitelisted users receive no session and are sent back to login.
 * REQ-1.4: whitelisted users get an authenticated session.
 * REQ-1.5: enforcement is server-side (the DB trigger is the trust boundary;
 *          this handler only maps the resulting error to a redirect).
 */

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isWhitelistError } from "@/lib/supabase/auth-utils";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  const origin = requestUrl.origin;

  // Provider-level denial (e.g. user dismissed the Google consent screen or
  // error=access_denied came from the OAuth provider itself).
  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=access_denied`);
  }

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // The DB trigger raises P0001 for non-whitelisted emails; Supabase
      // bubbles this up as an AuthError. Map all auth failures to a generic
      // access_denied redirect — do not leak internal error messages.
      const redirectParam = isWhitelistError(error)
        ? "access_denied"
        : "access_denied"; // keep the same param for any auth failure (REQ-1.3)
      return NextResponse.redirect(
        `${origin}/login?error=${redirectParam}`
      );
    }

    // Session established — send the user into the app.
    return NextResponse.redirect(`${origin}/`);
  }

  // No code and no error: malformed callback — fall back to login.
  return NextResponse.redirect(`${origin}/login`);
}
