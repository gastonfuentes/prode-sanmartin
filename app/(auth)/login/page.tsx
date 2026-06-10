/**
 * Login page — Server Component shell.
 *
 * Reads the ?error query param and surfaces an access-denied message when
 * a non-whitelisted user is redirected back here after OAuth.
 *
 * REQ-1.1: Google OAuth is the sole login method.
 * REQ-1.3: Non-whitelisted users receive an "access denied" error.
 */

import { GoogleSignInButton } from "@/components/google-sign-in-button";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const isAccessDenied = error === "access_denied";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          Prode San Martín
        </h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Group stage prediction game
        </p>

        {isAccessDenied && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Your email address is not authorized to access this app. Contact
            the organizer to be added to the allowlist.
          </div>
        )}

        <div className="flex justify-center">
          <GoogleSignInButton />
        </div>
      </div>
    </main>
  );
}
