/**
 * ParticipantsList — Server Component.
 *
 * Renders every registered profile with their avatar (Google photo or initials
 * fallback) and display name. Queries public.profiles directly — RLS allows
 * authenticated users to SELECT all rows; emails are NOT shown.
 *
 * Avatars are plain <img> tags (Google-hosted lh3.googleusercontent.com).
 * next/image is intentionally avoided to skip remotePatterns config (same
 * approach as team flag images in the prediction form).
 */

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ParticipantsListProps {
  profiles: Profile[];
}

// ── Avatar helpers ────────────────────────────────────────────────────────────

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ── ParticipantsList ──────────────────────────────────────────────────────────

export function ParticipantsList({ profiles }: ParticipantsListProps) {
  if (profiles.length === 0) {
    return (
      <p className="text-xs text-gray-400">Sin participantes registrados.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {profiles.map((profile) => (
        <li key={profile.id} className="flex items-center gap-2">
          {profile.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={profile.avatar_url}
              alt={profile.display_name ?? "Participante"}
              width={30}
              height={30}
              loading="lazy"
              className="h-[30px] w-[30px] shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-label={profile.display_name ?? "Participante"}
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700"
            >
              {getInitials(profile.display_name)}
            </span>
          )}
          <span className="truncate text-sm text-gray-700">
            {profile.display_name ?? "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
