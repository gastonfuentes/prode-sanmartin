/**
 * Join group page — Server Component.
 *
 * Sits OUTSIDE (app) route group to avoid the is_allowed() loop: users who
 * have no group yet fail is_allowed() and are redirected here by (app)/layout.
 * Redirecting them back into (app) would loop.
 *
 * Guards:
 *   - No session → /login
 *   - Already in a group → / (nothing to do here)
 */

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { JoinGroupForm } from "@/components/join-group-form";

export default async function JoinPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // If the user already has a group, send them to the app.
  const { data: groupId } = await supabase.rpc("current_user_group_id");
  if (groupId) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          Unite a tu grupo
        </h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Ingresá el código de invitación que te compartieron.
        </p>

        <JoinGroupForm />
      </div>
    </main>
  );
}
