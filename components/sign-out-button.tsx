"use client";

/**
 * SignOutButton — Client Component.
 *
 * Calls supabase.auth.signOut() and redirects to /login.
 * Must be a Client Component because it needs browser-side Supabase auth.
 *
 * TASK-28 — authenticated app chrome: sign-out action.
 */

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={handleSignOut}
      type="button"
      className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
    >
      Cerrar sesión
    </button>
  );
}
