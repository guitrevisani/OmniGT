// src/app/api/camp/[slug]/route.js
//
// GET /api/camp/[slug]
//
// Sem sessão  → dados públicos (apresentação)
// Com sessão  → dados públicos + acumulados + sessões + última atividade (dashboard)

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { getSession }   from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const { slug } = await params;

  const eventResult = await query(
    `SELECT e.id, e.name, e.slug,
            TO_CHAR(e.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(e.end_date,   'YYYY-MM-DD') AS end_date,
            ec.metadata
     FROM events e
     LEFT JOIN event_configs ec ON ec.event_id = e.id
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1 AND e.is_active = true AND m.slug = 'camp'`,
    [slug]
  );

  if (eventResult.rows.length === 0) {
    return NextResponse.json({ error: "Camp não encontrado" }, { status: 404 });
  }

  const event    = eventResult.rows[0];
  const metadata = event.metadata || {};

  const publicData = {
    id:          event.id,
    name:        event.name,
    slug:        event.slug,
    start_date:  event.start_date,
    end_date:    event.end_date,
    location:    metadata.location    || null,
    objective:   metadata.objective   || null,
    website_url: metadata.website_url || null,
  };

  // ── Sem sessão → só dados públicos ───────────────────
  const session = await getSession();
  if (!session) {
    return NextResponse.json(publicData);
  }

  const { stravaId } = session;

  // ── Com sessão → dados completos do atleta ───────────

  // Acumulados do camp
  // Acumulados do camp — apenas atividades com match em sessões configuradas
  const totalsResult = await query(
    `SELECT
       COALESCE(SUM(a.distance_m), 0)          AS total_distance_m,
       COALESCE(SUM(a.total_elevation_gain), 0) AS total_elevation_m,
       COALESCE(SUM(a.moving_time), 0)          AS total_moving_time_sec,
       COUNT(*)                                 AS total_activities
     FROM activities a
     JOIN camp_session_activities csa ON csa.strava_activity_id = a.strava_activity_id
     JOIN camp_sessions cs            ON cs.id = csa.session_id
     WHERE cs.event_id      = $1
       AND csa.strava_id    = $2
       AND a.duplicate_of IS NULL`,
    [event.id, stravaId]
  );

  const totals = totalsResult.rows[0];

  // TSS acumulado
  const tssResult = await query(
    `SELECT COALESCE(SUM(csa.tss), 0) AS total_tss
     FROM camp_session_activities csa
     JOIN camp_sessions cs ON cs.id = csa.session_id
     WHERE cs.event_id   = $1
       AND csa.strava_id = $2`,
    [event.id, stravaId]
  );

  const totalTss = parseFloat(tssResult.rows[0]?.total_tss || 0);

  // Sessões realizadas
  const sessionsResult = await query(
    `SELECT
       cs.day_number,
       cs.session_order,
       cs.short_description,
       a.title,
       a.distance_m,
       a.total_elevation_gain,
       a.moving_time,
       csa.tss,
       a.average_heartrate
     FROM camp_session_activities csa
     JOIN camp_sessions cs ON cs.id = csa.session_id
     JOIN activities a ON a.strava_activity_id = csa.strava_activity_id
     WHERE cs.event_id   = $1
       AND csa.strava_id = $2
     ORDER BY cs.day_number ASC, cs.session_order ASC`,
    [event.id, stravaId]
  );

  // Última atividade
  const lastActivityResult = await query(
    `SELECT
       a.strava_activity_id,
       TO_CHAR(COALESCE(a.start_date_local, a.start_date), 'YYYY-MM-DD') AS date,
       a.distance_m,
       a.total_elevation_gain,
       a.moving_time,
       a.average_heartrate,
       csa.tss
     FROM activities a
     JOIN event_activities ea ON ea.strava_activity_id = a.strava_activity_id
     LEFT JOIN camp_session_activities csa ON csa.strava_activity_id = a.strava_activity_id
     WHERE ea.event_id    = $1
       AND a.strava_id    = $2
       AND a.duplicate_of IS NULL
     ORDER BY a.start_date DESC
     LIMIT 1`,
    [event.id, stravaId]
  );

  return NextResponse.json({
    ...publicData,
    totals: {
      distance_m:      parseFloat(totals.total_distance_m),
      elevation_m:     parseFloat(totals.total_elevation_m),
      moving_time_sec: parseFloat(totals.total_moving_time_sec),
      activities:      parseInt(totals.total_activities),
      tss:             totalTss,
    },
    sessions:     sessionsResult.rows,
    lastActivity: lastActivityResult.rows[0] || null,
  });
}
