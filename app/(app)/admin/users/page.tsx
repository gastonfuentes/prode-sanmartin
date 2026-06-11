/**
 * Admin users — RSC.
 *
 * Lists every email the system knows about (via admin_list_users, migration 024)
 * and lets the admin grant access (alta), revoke it (soft baja) or reactivate a
 * previously revoked user. Admin access is enforced by app/(app)/admin/layout.tsx
 * and re-checked inside each RPC.
 *
 * Row states: Admin (protected) · active (no badge) · Pendiente (whitelisted but
 * not yet registered) · Inactivo (registered but revoked — can reactivate).
 */

import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AddEmailForm } from "@/components/admin/add-email-form";
import { UserRowActions } from "@/components/admin/user-row-actions";

interface AdminUserRow {
  email: string;
  display_name: string | null;
  registered: boolean;
  active: boolean;
  is_admin: boolean;
  added_at: string | null;
}

export default async function AdminUsersPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const callerEmail = user?.email?.toLowerCase() ?? null;

  const { data } = await supabase.rpc("admin_list_users");
  const users = (data ?? []) as AdminUserRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600">
          ← Panel
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Usuarios</h1>
        <p className="mt-1 text-sm text-gray-500">
          Dale acceso a un amigo agregando su email de Google, o quitáselo.
        </p>
      </div>

      <AddEmailForm />

      {users.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
          Todavía no hay usuarios. Agregá el primero con el formulario de arriba.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {users.map((u) => (
            <li
              key={u.email}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-gray-900">
                    {u.display_name ?? u.email}
                  </span>
                  {u.is_admin && (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      Admin
                    </span>
                  )}
                  {!u.is_admin && !u.active && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      Inactivo
                    </span>
                  )}
                  {!u.is_admin && u.active && !u.registered && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Pendiente
                    </span>
                  )}
                </div>
                {u.display_name && (
                  <p className="truncate text-xs text-gray-400">{u.email}</p>
                )}
              </div>

              {!u.is_admin && (
                <UserRowActions
                  email={u.email}
                  active={u.active}
                  isSelf={u.email === callerEmail}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
