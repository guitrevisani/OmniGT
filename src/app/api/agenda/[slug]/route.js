import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { cookies } from "next/headers";

export const runtime = "nodejs";

/**
 * GET /api/agenda/[slug]
 * Retorna todos os dados necessários para o dashboard do módulo Agenda.
 * Acesso restrito ao owner do evento.
 */
export async function GET(request, { params }) {
  try {
    const { slug } = await params;

    // ── Sessão ────────────────────────────────────────────────
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;

    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const stravaId = Number(session);

    // ── Buscar evento ─────────────────────────────────────────
    const eventResult = await query(
      `SELECT id, name, slug, start_date, end_date, owner_strava_id
       FROM events
       WHERE slug = $1 AND is_active = true`,
      [slug]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
    }

    const event = eventResult.rows[0];

    // ── Verificar acesso (owner ou provider) ──────────────────
    const roleResult = await query(
      `SELECT role FROM athlete_events
       WHERE strava_id = $1 AND event_id = $2 AND status = 'active'`,
      [stravaId, event.id]
    );

    if (roleResult.rows.length === 0) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const role = roleResult.rows[0].role;
    if (!["provider", "owner"].includes(role)) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    // ── Buscar metas ──────────────────────────────────────────
    const goalsResult = await query(
      `SELECT goal_distance_km, goal_moving_time_sec
       FROM agenda_goals
       WHERE event_id = $1 AND strava_id = $2`,
      [event.id, stravaId]
    );

    const goals = goalsResult.rows[0] || { goal_distance_km: 0, goal_moving_time_sec: 0 };

    // ── Buscar dados diários ──────────────────────────────────
    const dailyResult = await query(
      `SELECT
         activity_date,
         total_distance_m,
         treino_distance_m,
         desloc_distance_m,
         total_moving_time_sec,
         treino_moving_time_sec,
         desloc_moving_time_sec,
         total_elevation_gain_m
       FROM agenda_daily
       WHERE event_id = $1 AND strava_id = $2
       ORDER BY activity_date ASC`,
      [event.id, stravaId]
    );

    const daily = dailyResult.rows.map(r => ({
      date:          r.activity_date.toISOString().slice(0, 10),
      distance_m:    r.total_distance_m,
      treino_m:      r.treino_distance_m,
      desloc_m:      r.desloc_distance_m,
      moving_sec:    r.total_moving_time_sec,
      treino_sec:    r.treino_moving_time_sec,
      desloc_sec:    r.desloc_moving_time_sec,
      elevation_m:   r.total_elevation_gain_m,
      is_active:     r.total_moving_time_sec >= 900,
    }));

    return NextResponse.json({
      event: {
        id:         event.id,
        name:       event.name,
        slug:       event.slug,
        start_date: event.start_date.toISOString().slice(0, 10),
        end_date:   event.end_date.toISOString().slice(0, 10),
      },
      goals: {
        distance_km:     Number(goals.goal_distance_km),
        moving_time_sec: Number(goals.goal_moving_time_sec),
      },
      daily,
    });

  } catch (error) {
    console.error("[Agenda API] Erro:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
