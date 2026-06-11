"use server";

/**
 * Server actions for the admin user-management page.
 *
 * All actions run server-side with the session-scoped SSR Supabase client. The
 * real authorization lives in the SECURITY DEFINER RPCs (migration 024), which
 * re-check is_admin() — these actions just call them, map the DB error codes to
 * friendly Spanish messages, and revalidate the page.
 *
 * Error codes (migration 024):
 *   P0001 -> not an admin / invalid input
 *   P0002 -> cannot revoke yourself
 *   P0003 -> cannot revoke another admin
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeEmail, isValidEmail } from "@/lib/admin-users";
import { revalidatePath } from "next/cache";

export type AdminUserActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Adds an email to the whitelist (alta). Idempotent on the DB side, so this also
 * reactivates a previously revoked user — their profile and predictions are kept.
 */
export async function addAllowedEmail(
  email: string
): Promise<AdminUserActionResult> {
  const normalized = normalizeEmail(email);

  // Client mirrors this, but never trust the form — validate shape server-side.
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "Ingresá un email válido." };
  }

  const supabase = await createServerSupabaseClient();

  // Belt-and-suspenders; the /admin layout guard already checked admin status.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado." };
  }

  const { error } = await supabase.rpc("admin_add_allowed_email", {
    p_email: normalized,
  });

  if (error) {
    if (error.code === "P0001") {
      return { ok: false, error: "No tenés permisos para realizar esta acción." };
    }
    return { ok: false, error: "No se pudo agregar el email. Intentá de nuevo." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Revokes a user's access (soft baja): removes the email from the whitelist only.
 * Their profile and predictions are preserved; they are ejected on their next
 * request by the layout's is_allowed() check.
 */
export async function revokeAccess(
  email: string
): Promise<AdminUserActionResult> {
  const normalized = normalizeEmail(email);

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado." };
  }

  const { error } = await supabase.rpc("admin_revoke_access", {
    p_email: normalized,
  });

  if (error) {
    switch (error.code) {
      case "P0002":
        return { ok: false, error: "No podés quitarte el acceso a vos mismo." };
      case "P0003":
        return { ok: false, error: "No se puede quitar el acceso a un administrador." };
      case "P0001":
        return { ok: false, error: "No tenés permisos para realizar esta acción." };
      default:
        return { ok: false, error: "No se pudo quitar el acceso. Intentá de nuevo." };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
