/**
 * Guarded app shell layout.
 *
 * - Calls createServerSupabaseClient + getUser (server-side session check).
 * - Unauthenticated users are redirected to /login.
 * - Renders the authenticated chrome: header with app name + sign-out.
 *
 * TASK-28 — REQ-1.4: whitelisted, authenticated users can access the app.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/supabase/admin";
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

  const isAdmin = await isCurrentUserAdmin(supabase);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-bold text-gray-900">
            Prode San Martín
          </Link>
          <div className="flex items-center gap-4">
            {isAdmin && (
              <Link
                href="/admin"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Admin
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
