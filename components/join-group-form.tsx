"use client";

/**
 * JoinGroupForm — Client Component.
 *
 * Single code input to join a group by invite code. Calls the joinGroup server
 * action; on success redirects to the app root. Error banner mirrors
 * components/admin/add-email-form.tsx.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinGroup } from "@/app/join/actions";

export function JoinGroupForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmed = code.trim();
    if (!trimmed) {
      setError("Ingresá un código de invitación.");
      return;
    }

    startTransition(async () => {
      const result = await joinGroup(trimmed);
      if (result.ok) {
        router.refresh();
        router.push("/");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="CODIGO123"
          disabled={isPending}
          aria-label="Código de invitación"
          className="h-10 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Uniéndose…" : "Unirse"}
        </button>
      </div>

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
