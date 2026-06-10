/**
 * Admin section guard.
 *
 * The parent (app) layout already enforces authentication (redirects to /login
 * when there is no session). This nested layout adds the admin check: any
 * non-admin user who reaches /admin/** gets a 404 (notFound) — we hide the
 * existence of the admin area rather than returning a 403.
 *
 * Route handlers under /admin (export, image) do NOT inherit this layout, so
 * they re-check admin status inline.
 */

import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/supabase/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();

  if (!(await isCurrentUserAdmin(supabase))) {
    notFound();
  }

  return <>{children}</>;
}
