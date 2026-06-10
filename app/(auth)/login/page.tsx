/**
 * Login page — Server Component shell.
 *
 * Split layout: promotional cover image on one side, the sign-in card on the
 * other. On md+ the two sit side by side (image left, login right); on mobile
 * they stack (image on top, login below).
 *
 * Reads the ?error query param and surfaces an access-denied message when
 * a non-whitelisted user is redirected back here after OAuth.
 *
 * REQ-1.1: Google OAuth is the sole login method.
 * REQ-1.3: Non-whitelisted users receive an "access denied" error.
 */

import Image from "next/image";
import portada from "@/public/portada.png";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const isAccessDenied = error === "access_denied";

  return (
    <main className="flex min-h-screen flex-col md:flex-row">
      {/* ── Promo image side — hidden on mobile (horizontal flyer doesn't
          read well in a portrait viewport); shown from md+ at 70% width. ── */}
      <div className="hidden items-center justify-center bg-gray-950 md:flex md:w-[70%] md:shrink-0">
        <Image
          src={portada}
          alt="Hacé tu Prode — Copa Mundial de la FIFA 2026"
          placeholder="blur"
          sizes="(min-width: 768px) 70vw, 0px"
          className="h-auto w-full"
        />
      </div>

      {/* ── Login side ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md">
          <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
            Prode San Martín
          </h1>
          <p className="mb-8 text-center text-sm text-gray-500">
            Pronósticos de la fase de grupos
          </p>

          {isAccessDenied && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              Acceso denegado. Tu cuenta no está autorizada para acceder a esta app. Contactá al organizador para que te agregue.
            </div>
          )}

          <div className="flex justify-center">
            <GoogleSignInButton />
          </div>
        </div>
      </div>
    </main>
  );
}
