"use client";

/**
 * GoogleSignInButton — Client Component.
 *
 * Calls supabase.auth.signInWithOAuth to start the Google OAuth flow.
 * The redirectTo points to /auth/callback (our exchange route handler).
 * The browser is redirected to Google; no credentials are handled client-side.
 */

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { buildOAuthRedirectUrl } from "@/lib/supabase/auth-utils";

export function GoogleSignInButton() {
  async function handleSignIn() {
    const supabase = createBrowserSupabaseClient();
    const redirectTo = buildOAuthRedirectUrl(window.location.origin);

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });
    // Browser is redirected to Google; nothing more to do here.
  }

  return (
    <button
      onClick={handleSignIn}
      type="button"
      className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M17.64 9.2045c0-.638-.0573-1.252-.164-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
          fill="#4285F4"
        />
        <path
          d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.328-1.584-5.036-3.7145H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
          fill="#34A853"
        />
        <path
          d="M3.964 10.705c-.18-.54-.2822-1.1168-.2822-1.705 0-.5882.1023-1.165.2822-1.705V4.9632H.9573A8.9965 8.9965 0 0 0 0 9c0 1.452.3477 2.8264.9573 4.0368L3.964 10.705z"
          fill="#FBBC05"
        />
        <path
          d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.891 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9632L3.964 7.295C4.672 5.1645 6.656 3.5795 9 3.5795z"
          fill="#EA4335"
        />
      </svg>
      Iniciar sesión con Google
    </button>
  );
}
