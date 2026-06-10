/**
 * Guarded app shell layout.
 *
 * - Calls createServerSupabaseClient + getUser (server-side session check).
 * - Unauthenticated users are redirected to /login.
 * - Renders the authenticated chrome: header with app name + sign-out.
 *
 * TASK-28 — REQ-1.4: whitelisted, authenticated users can access the app.
 */

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <span className="text-lg font-bold text-gray-900">
            Prode San Martín
          </span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
