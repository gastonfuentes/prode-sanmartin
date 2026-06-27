/**
 * Admin groups — RSC.
 *
 * Lists all groups (via admin_list_groups, migration 035) and lets the admin
 * create new ones. Each row shows the group name, member count, invite code,
 * and the /join?code=<code> link to share.
 *
 * Admin access is enforced by app/(app)/admin/layout.tsx.
 */

import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CreateGroupForm } from "@/components/admin/create-group-form";

interface AdminGroupRow {
  id: number;
  name: string;
  invite_code: string;
  member_count: number;
  created_at: string;
}

export default async function AdminGroupsPage() {
  const supabase = await createServerSupabaseClient();

  const { data } = await supabase.rpc("admin_list_groups");
  const groups = (data ?? []) as AdminGroupRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600">
          ← Panel
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Grupos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Creá grupos de amigos y compartí el código de invitación.
        </p>
      </div>

      <CreateGroupForm />

      {groups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
          Todavía no hay grupos. Creá el primero con el formulario de arriba.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {groups.map((g) => {
            const joinPath = `/join?code=${encodeURIComponent(g.invite_code)}`;
            return (
              <li
                key={g.id}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-gray-900">
                      {g.name}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {g.member_count} {g.member_count === 1 ? "miembro" : "miembros"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Código:{" "}
                    <span className="font-mono font-semibold text-gray-700">
                      {g.invite_code}
                    </span>
                  </p>
                  <p className="text-xs text-gray-400 break-all">
                    Link:{" "}
                    <a
                      href={joinPath}
                      className="font-mono text-indigo-600 hover:text-indigo-800 underline"
                    >
                      {joinPath}
                    </a>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
