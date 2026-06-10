/**
 * Admin authorization helper.
 *
 * Resolves whether the current session user is an admin by calling the
 * is_admin() SECURITY DEFINER RPC (migration 020). The admins table has no
 * client-readable RLS policy, so this RPC is the ONLY way the app can check
 * admin status — clients cannot enumerate or read the whitelist directly.
 *
 * Used by the /admin layout guard, the header nav, and the export/image route
 * handlers (which cannot inherit the layout guard).
 */

import type { createServerSupabaseClient } from "./server";

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * Returns true when the authenticated caller is an admin.
 *
 * Fails closed: any RPC error (including the absence of a session) resolves to
 * false so a transient failure never grants admin access.
 */
export async function isCurrentUserAdmin(
  supabase: ServerClient
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) return false;
  return data === true;
}
