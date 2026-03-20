// src/app/api/athlete/home/route.js
//
// GET /api/athlete/home
//
// Retorna dados personalizados para a landing do atleta:
//   - dados pessoais
//   - eventos ativos com slug
//   - atividades do último dia com atividades processadas

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { getSession }   from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { stravaId } = session;

  // ── Dados pessoais ────────────────────────────────────
  const athleteResult = await query(
    `SELECT firstname, lastname, email, gender, birth_date
     FROM athletes
     WHERE strava_id = $1`,
    [stravaId]
  );

  if (athleteResult.rows.length === 0) {
    return NextResponse.json({ error: "Atleta não encontrado" }, { status: 404 });
  }

  const athlete = athleteResult.rows[0];

  // ── Eventos ativos ────────────────────────────────────
  const eventsResult = await query(
    `SELECT e.name, e.slug, m.slug AS module_slug,
            TO_CHAR(e.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(e.end_date,   'YYYY-MM-DD') AS end_date
     FROM athlete_events ae
     JOIN events e  ON e.id  = ae.event_id
     JOIN modules m ON m.id  = e.module_id
     WHERE ae.strava_id = $1
       AND ae.status    = 'active'
       AND e.is_active  = true
     ORDER BY e.start_date DESC`,
    [stravaId]
  );

  // ── Atividades do último dia processado ───────────────
  const activitiesResult = await query(
    `SELECT
       a.strava_activity_id,
       a.title,
       TO_CHAR(COALESCE(a.start_date_local, a.start_date), 'YYYY-MM-DD') AS date,
       TO_CHAR(COALESCE(a.start_date_local, a.start_date), 'HH24:MI')    AS time
     FROM activities a
     WHERE a.strava_id      = $1
       AND a.duplicate_of  IS NULL
       AND a.engine_last_put_at IS NOT NULL
       AND COALESCE(a.start_date_local, a.start_date)::date = (
         SELECT MAX(COALESCE(start_date_local, start_date)::date)
         FROM activities
         WHERE strava_id        = $1
           AND duplicate_of    IS NULL
           AND engine_last_put_at IS NOT NULL
       )
     ORDER BY COALESCE(a.start_date_local, a.start_date) DESC`,
    [stravaId]
  );

  return NextResponse.json({
    athlete: {
      firstname:  athlete.firstname,
      lastname:   athlete.lastname,
      email:      athlete.email,
      gender:     athlete.gender,
      birth_date: athlete.birth_date
        ? new Date(athlete.birth_date).toISOString().slice(0, 10)
        : null,
    },
    events:     eventsResult.rows,
    activities: activitiesResult.rows,
  });
}
