/**
 * Per-player PNG card route handler — GET /admin/image/<roundId>/<userId>.
 *
 * Renders one participant's predictions for one locked round as a PNG using
 * next/og (Satori). Server-rendered from data — NOT a DOM screenshot — so the
 * output is consistent regardless of the admin's device.
 *
 * Route handlers do NOT inherit the /admin layout guard, so admin status is
 * re-checked here. admin_round_predictions() gates on is_admin() AND post-lock
 * at the DB layer; we filter its rows to the requested player.
 *
 * Satori constraints honored below: every container with >1 child sets
 * display:flex, and all styling is inline (no Tailwind, no external CSS).
 * The avatar is fetched and inlined as a data URL with an initials fallback so
 * a broken/blocked remote image can never fail the whole render.
 */

import { ImageResponse } from "next/og";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/supabase/admin";
import {
  buildPlayerCard,
  type AdminPredictionRow,
  type PlayerCardModel,
} from "@/lib/admin-export";

const WIDTH = 620;
const ROW_HEIGHT = 46;
const CHROME_HEIGHT = 250; // padding + header + table header + footer
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // strip combining diacritics
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Fetches a remote image and inlines it as a data URL; null on any failure. */
async function toDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

function CardTemplate({
  card,
  avatarDataUrl,
}: {
  card: PlayerCardModel;
  avatarDataUrl: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#ffffff",
        padding: "32px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {avatarDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarDataUrl}
            width={56}
            height={56}
            style={{ borderRadius: "28px", objectFit: "cover" }}
            alt=""
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56px",
              height: "56px",
              borderRadius: "28px",
              backgroundColor: "#e0e7ff",
              color: "#4338ca",
              fontSize: "20px",
              fontWeight: 700,
            }}
          >
            {getInitials(card.playerName)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "26px", fontWeight: 700, color: "#111827" }}>
            {card.playerName}
          </span>
          <span style={{ fontSize: "15px", color: "#6b7280" }}>
            {card.roundLabel} · Prode San Martín
          </span>
        </div>
      </div>

      {/* Table header */}
      <div
        style={{
          display: "flex",
          marginTop: "24px",
          paddingBottom: "8px",
          borderBottom: "2px solid #e5e7eb",
          fontSize: "13px",
          color: "#9ca3af",
          fontWeight: 600,
        }}
      >
        <span style={{ display: "flex", flex: 1 }}>PARTIDO</span>
        <span style={{ display: "flex", width: "70px", justifyContent: "center" }}>
          PRON.
        </span>
        <span style={{ display: "flex", width: "70px", justifyContent: "center" }}>
          RESULT.
        </span>
        <span style={{ display: "flex", width: "50px", justifyContent: "flex-end" }}>
          PTS
        </span>
      </div>

      {/* Rows */}
      {card.rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            height: `${ROW_HEIGHT}px`,
            borderBottom: "1px solid #f3f4f6",
            fontSize: "16px",
            color: "#1f2937",
          }}
        >
          <span style={{ display: "flex", flex: 1 }}>{r.match}</span>
          <span
            style={{
              display: "flex",
              width: "70px",
              justifyContent: "center",
              fontWeight: 600,
              color: "#111827",
            }}
          >
            {r.prediction}
          </span>
          <span
            style={{
              display: "flex",
              width: "70px",
              justifyContent: "center",
              color: "#6b7280",
            }}
          >
            {r.result || "—"}
          </span>
          <span
            style={{
              display: "flex",
              width: "50px",
              justifyContent: "flex-end",
              fontWeight: 700,
              color: "#111827",
            }}
          >
            {r.points}
          </span>
        </div>
      ))}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          paddingTop: "16px",
          justifyContent: "flex-end",
          fontSize: "16px",
          color: "#374151",
        }}
      >
        <span style={{ display: "flex" }}>
          Total: {card.totalPoints} pts · {card.exactCount} exactos
        </span>
      </div>
    </div>
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roundId: string; userId: string }> }
) {
  const { roundId, userId } = await params;

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isCurrentUserAdmin(supabase))) {
    return new Response("Forbidden", { status: 403 });
  }

  const rid = Number(roundId);
  if (!Number.isFinite(rid) || rid <= 0) {
    return new Response("Bad request", { status: 400 });
  }
  if (!UUID_RE.test(userId)) {
    return new Response("Bad request", { status: 400 });
  }

  const { data, error } = await supabase.rpc("admin_round_predictions", {
    p_round_id: rid,
  });
  if (error) {
    return new Response("Error generating image", { status: 500 });
  }

  const rows = ((data ?? []) as AdminPredictionRow[]).filter(
    (r) => r.user_id === userId
  );
  const card = buildPlayerCard(rows);
  if (!card) {
    return new Response("Not found", { status: 404 });
  }

  const avatarDataUrl = await toDataUrl(card.avatarUrl);
  const height = CHROME_HEIGHT + card.rows.length * ROW_HEIGHT;
  const filename = `apuestas-fecha-${rid}-${slugify(card.playerName)}.png`;

  return new ImageResponse(
    <CardTemplate card={card} avatarDataUrl={avatarDataUrl} />,
    {
      width: WIDTH,
      height,
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    }
  );
}
