// /src/app/api/agenda/sync/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/agenda/sync
 *
 * Rota pública intermediária para disparo manual do backfill.
 * O secret nunca é exposto ao cliente — a chamada ao backfill
 * é feita server-side com o INTERNAL_WORKER_SECRET.
 *
 * Requer sessão ativa e inscrição no evento.
 */
export async function POST(request) {
  try {
    const { slug } = await request.json();

    if (!slug) {
      return NextResponse.json({ error: "slug ausente" }, { status: 400 });
    }

    // ── Verificar sessão ──────────────────────────────────
    const cookieStore = await cookies();
    const session     = cookieStore.get("session")?.value;
    const stravaId    = session ? Number(session) : null;

    if (!stravaId) {
      return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
    }

    // ── Buscar evento ─────────────────────────────────────
    const eventResult = await query(
      `SELECT e.id FROM events e
       WHERE e.slug = $1 AND e.is_active = true`,
      [slug]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
    }

    const eventId = eventResult.rows[0].id;

    // ── Verificar inscrição ───────────────────────────────
    const memberResult = await query(
      `SELECT role FROM athlete_events
       WHERE strava_id = $1 AND event_id = $2 AND status = 'active'`,
      [stravaId, eventId]
    );

    if (memberResult.rows.length === 0) {
      return NextResponse.json({ error: "Não inscrito neste evento" }, { status: 403 });
    }

    // ── Disparar backfill server-side ─────────────────────
    const base = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;

    const backfillRes = await fetch(`${base}/api/agenda/backfill`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.INTERNAL_WORKER_SECRET}`,
      },
      body: JSON.stringify({ strava_id: stravaId, event_id: eventId }),
    });

    if (!backfillRes.ok) {
      const err = await backfillRes.text();
      console.error("[Sync] Backfill falhou:", err);
      return NextResponse.json({ error: "Falha ao sincronizar" }, { status: 500 });
    }

    const result = await backfillRes.json();
    return NextResponse.json({ ok: true, ...result });

  } catch (err) {
    console.error("[Sync] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
