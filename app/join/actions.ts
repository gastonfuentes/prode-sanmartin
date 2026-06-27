"use server";

/**
 * Server actions for the join-group page.
 *
 * join_group(p_code) is a SECURITY DEFINER RPC (migration 035) that validates
 * the invite code and registers the caller in the group. Error codes:
 *   P0002 → caller already belongs to another group
 *   other → invalid or expired code
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type JoinResult = { ok: true } | { ok: false; error: string };

export async function joinGroup(code: string): Promise<JoinResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado." };
  }

  const { error } = await supabase.rpc("join_group", { p_code: code.trim() });

  if (error) {
    if (error.code === "P0002") {
      return { ok: false, error: "Ya pertenecés a un grupo." };
    }
    return { ok: false, error: "Código inválido. Verificá e intentá de nuevo." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
