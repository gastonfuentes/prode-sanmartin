"use client";

/**
 * AddEmailForm — Client Component.
 *
 * Single email input to grant a friend access (alta). Validates the email shape
 * client-side for instant feedback, then calls the addAllowedEmail server action.
 * Success/error banners mirror the prediction form.
 */

import { useState, useTransition } from "react";
import { isValidEmail } from "@/lib/admin-users";
import { addAllowedEmail } from "@/app/(app)/admin/users/actions";

export function AddEmailForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError("Ingresá un email válido.");
      return;
    }

    startTransition(async () => {
      const result = await addAllowedEmail(trimmed);
      if (result.ok) {
        setSuccess(`Acceso otorgado a ${trimmed.toLowerCase()}.`);
        setEmail("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
            setSuccess(null);
          }}
          placeholder="amigo@gmail.com"
          disabled={isPending}
          aria-label="Email del usuario a agregar"
          className="h-10 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Agregando…" : "Agregar"}
        </button>
      </div>

      {success && (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800"
        >
          {success}
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
