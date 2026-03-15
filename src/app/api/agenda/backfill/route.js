import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getValidAccessToken } from "@/lib/strava";

export const runtime = "nodejs";

const STRAVA_API    = "https://www.strava.com/api/v3";
const PAGE_SIZE     = 200;
const MAX_PAGES     = 10;
const PAGE_DELAY_MS = 1000;

export async function POST(request) {
  try {
    const body = await request.json();
    const { strava_id, event_id } = body;

    if (!strava_id || !event_id) {
      return NextResponse.json(
        { error: "Parâmetros ausentes: strava_id e event_id são obrigatórios" },
        { status: 400 }
      );
    }

    // ── 1. Buscar evento ──────────────────────────────────────
    const eventResult = await query(
      `SELECT id, slug, start_date, end_date
       FROM events
       WHERE id = $1 AND is_active = true`,
      [event_id]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Evento não encontrado ou inativo" },
        { status: 404 }
      );
    }

    const event = eventResult.rows[0];

    const afterTs = Math.floor(new Date(event.start_date).getTime() / 1000);
    const endDate = new Date(event.end_date);

    console.log("[Backfill] event:", event);
    console.log("[Backfill] afterTs:", afterTs, "→", new Date(afterTs * 1000).toISOString());
    console.log("[Backfill] endDate:", endDate.toISOString());

    // ── 2. Obter token válido ─────────────────────────────────
    let accessToken;
    try {
      accessToken = await getValidAccessToken(strava_id);
      console.log("[Backfill] token obtido, primeiros 10 chars:", accessToken?.slice(0, 10));
    } catch (err) {
      console.error(`[Backfill] Token inválido para atleta ${strava_id}:`, err.message);
      return NextResponse.json(
        { error: "Token do atleta inválido ou expirado" },
        { status: 401 }
      );
    }

    // ── 3. Buscar atividades paginadas no Strava ──────────────
    let page          = 1;
    let totalFetched  = 0;
    let totalInserted = 0;
    let hasMore       = true;

    const daysToConsolidate = new Set();

    while (hasMore && page <= MAX_PAGES) {
      const url = new URL(`${STRAVA_API}/athlete/activities`);
      url.searchParams.set("after",    String(afterTs));
      url.searchParams.set("per_page", String(PAGE_SIZE));
      url.searchParams.set("page",     String(page));

      console.log("[Backfill] chamando Strava:", url.toString());

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log("[Backfill] Strava status:", res.status);

      if (!res.ok) {
        const errBody = await res.text();
        console.error(`[Backfill] Strava API error (page ${page}):`, res.status, errBody);
        break;
      }

      const activities = await res.json();

      console.log("[Backfill] atividades recebidas:", Array.isArray(activities) ? activities.length : typeof activities);
      if (Array.isArray(activities) && activities.length > 0) {
        console.log("[Backfill] primeira atividade start_date:", activities[0].start_date);
        console.log("[Backfill] última atividade start_date:", activities[activities.length - 1].start_date);
      }

      if (!Array.isArray(activities) || activities.length === 0) {
        hasMore = false;
        break;
      }

      totalFetched += activities.length;

      // ── 4. UPSERT de cada atividade ─────────────────────────
      for (const act of activities) {
        const actDate = act.start_date_local
          ? act.start_date_local.slice(0, 10)
          : act.start_date
            ? act.start_date.slice(0, 10)
            : null;

        if (!actDate) continue;

        const actDateObj = new Date(actDate);
        if (actDateObj > endDate) continue;

        // a. UPSERT em activities
        await query(
          `INSERT INTO activities (
             strava_activity_id, strava_id,
             start_date, start_date_local, distance_m,
             moving_time, elapsed_time,
             total_elevation_gain, commute,
             gear_id, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (strava_activity_id) DO UPDATE SET
             distance_m           = EXCLUDED.distance_m,
             start_date_local     = EXCLUDED.start_date_local,
             moving_time          = EXCLUDED.moving_time,
             elapsed_time         = EXCLUDED.elapsed_time,
             total_elevation_gain = EXCLUDED.total_elevation_gain,
             commute              = EXCLUDED.commute,
             gear_id              = EXCLUDED.gear_id,
             updated_at           = now()`,
          [
            act.id,
            strava_id,
            act.start_date,
            act.start_date_local || null,
            act.distance             || 0,
            act.moving_time          || 0,
            act.elapsed_time         || 0,
            act.total_elevation_gain || 0,
            act.commute              || false,
            act.gear_id              || null,
          ]
        );

        // b. UPSERT em event_activities
        await query(
          `INSERT INTO event_activities (event_id, strava_activity_id, processed)
           VALUES ($1, $2, false)
           ON CONFLICT (event_id, strava_activity_id) DO NOTHING`,
          [event_id, act.id]
        );

        daysToConsolidate.add(actDate);
        totalInserted++;
      }

      if (activities.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
        await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
      }
    }

    // ── 5. Consolidar agenda_daily ────────────────────────────
    let totalConsolidated = 0;

    for (const actDate of daysToConsolidate) {
      await query(
        `INSERT INTO agenda_daily (
           event_id, strava_id, activity_date,
           total_distance_m, total_elevation_gain_m,
           total_moving_time_sec, total_elapsed_time_sec,
           treino_distance_m, desloc_distance_m,
           treino_moving_time_sec, desloc_moving_time_sec
         )
         SELECT
           $1, $2, $3::date,
           COALESCE(SUM(distance_m), 0)::integer,
           COALESCE(SUM(total_elevation_gain), 0)::integer,
           COALESCE(SUM(moving_time), 0)::integer,
           COALESCE(SUM(elapsed_time), 0)::integer,
           COALESCE(SUM(CASE WHEN commute = false THEN distance_m  ELSE 0 END), 0)::integer,
           COALESCE(SUM(CASE WHEN commute = true  THEN distance_m  ELSE 0 END), 0)::integer,
           COALESCE(SUM(CASE WHEN commute = false THEN moving_time ELSE 0 END), 0)::integer,
           COALESCE(SUM(CASE WHEN commute = true  THEN moving_time ELSE 0 END), 0)::integer
         FROM activities
         WHERE strava_id = $2
           AND COALESCE(start_date_local, start_date)::date = $3::date
         ON CONFLICT (event_id, strava_id, activity_date) DO UPDATE SET
           total_distance_m       = EXCLUDED.total_distance_m,
           total_elevation_gain_m = EXCLUDED.total_elevation_gain_m,
           total_moving_time_sec  = EXCLUDED.total_moving_time_sec,
           total_elapsed_time_sec = EXCLUDED.total_elapsed_time_sec,
           treino_distance_m      = EXCLUDED.treino_distance_m,
           desloc_distance_m      = EXCLUDED.desloc_distance_m,
           treino_moving_time_sec = EXCLUDED.treino_moving_time_sec,
           desloc_moving_time_sec = EXCLUDED.desloc_moving_time_sec`,
        [event_id, strava_id, actDate]
      );

      totalConsolidated++;
    }

    console.log(
      `[Backfill] CONCLUÍDO strava_id=${strava_id} event_id=${event_id} ` +
      `fetched=${totalFetched} upserted=${totalInserted} days=${totalConsolidated}`
    );

    return NextResponse.json({
      success:             true,
      strava_id,
      event_id,
      pages_fetched:       page - 1,
      activities_total:    totalFetched,
      activities_upserted: totalInserted,
      days_consolidated:   totalConsolidated,
    });

  } catch (error) {
    console.error("[Backfill] Erro interno:", error);
    return NextResponse.json(
      { error: "Backfill failed", detail: error.message },
      { status: 500 }
    );
  }
}
