"use server";

/**
 * Server actions for the admin groups page.
 *
 * admin_create_group(p_name) is a SECURITY DEFINER RPC (migration 035) that
 * creates a group and returns its id, name, and invite_code. The real
 * authorization lives in the RPC (re-checks is_admin()); this action just
 * calls it, maps errors to friendly messages, and revalidates the page.
 *
 * Error codes (migration 035):
 *   P0001 → not an admin / invalid input
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type CreateGroupResult =
  | { ok: true; id: number; name: string; invite_code: string }
  | { ok: false; error: string };

export async function createGroup(name: string): Promise<CreateGroupResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado." };
  }

  const { data, error } = await supabase.rpc("admin_create_group", {
    p_name: name.trim(),
  });

  if (error) {
    if (error.code === "P0001") {
      return { ok: false, error: "No tenés permisos para realizar esta acción." };
    }
    return { ok: false, error: "No se pudo crear el grupo. Intentá de nuevo." };
  }

  // admin_create_group returns a single row; Supabase RPC returns it as an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, error: "No se pudo crear el grupo. Intentá de nuevo." };
  }

  revalidatePath("/admin/groups");
  return { ok: true, id: row.id, name: row.name, invite_code: row.invite_code };
}
