"use client";

/**
 * CreateGroupForm — Client Component.
 *
 * Single name input to create a new group. On success shows the generated
 * invite code and the /join?code=<code> link so the admin can share it.
 * Error/success banners mirror components/admin/add-email-form.tsx.
 */

import { useState, useTransition } from "react";
import { createGroup } from "@/app/(app)/admin/groups/actions";

export function CreateGroupForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    name: string;
    invite_code: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreated(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Ingresá un nombre para el grupo.");
      return;
    }

    startTransition(async () => {
      const result = await createGroup(trimmed);
      if (result.ok) {
        setCreated({ name: result.name, invite_code: result.invite_code });
        setName("");
      } else {
        setError(result.error);
      }
    });
  }

  const joinLink = created
    ? `/join?code=${encodeURIComponent(created.invite_code)}`
    : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
            setCreated(null);
          }}
          placeholder="Nombre del grupo"
          disabled={isPending}
          aria-label="Nombre del grupo a crear"
          className="h-10 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Creando…" : "Crear grupo"}
        </button>
      </div>

      {created && joinLink && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          <span className="font-semibold">
            Grupo &quot;{created.name}&quot; creado.
          </span>
          <span>
            Código:{" "}
            <span className="font-mono font-semibold">{created.invite_code}</span>
          </span>
          <span>
            Link de invitación:{" "}
            <a
              href={joinLink}
              className="break-all font-mono text-green-700 underline hover:text-green-900"
            >
              {joinLink}
            </a>
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </form>
  );
}
