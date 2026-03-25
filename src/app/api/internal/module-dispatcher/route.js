import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getValidAccessToken } from "@/lib/strava";
import { mergeDescription } from "@/engine/mergeDescription";

import { buildDescription }                    from "@/engine/modules/agenda/buildDescription.js";
import { consolidate as campConsolidate,
         buildDescription as campBuildDescription } from "@/engine/modules/camp/index.js";

export const runtime     = "nodejs";
export const maxDuration = 60;

const STRAVA_API         = "https://www.strava.com/api/v3";
const ACTIVE_DAY_MIN_SEC = 900;

/**
 * ============================================================
 * MODULE REGISTRY
 * ============================================================
 *
 * Cada módulo expõe:
 *   consolidate(context) → dados consolidados direto de activities
 *   build(data, context) → string do bloco de descrição
 *
 * accepted_sport_types é lido de event_configs.metadata por evento (ADR-010).
 * Para adicionar um módulo: adicionar entrada aqui.
 * Worker e dispatcher não precisam de outras alterações.
 * ============================================================
 */
const MODULE_REGISTRY = {
  agenda: {

    /**
     * Consolida dados diretamente de activities para a atividade X.
     *
     * Retroativamente ignorante: nunca soma atividades com
     * start_date posterior ao de X.
     *
     * Usa start_date_local para agrupamento por dia — garante
     * atribuição correta independente de timezone.
     */
    async consolidate(context) {
      const totalsResult = await query(
        `SELECT
           COALESCE(SUM(a.distance_m), 0)          AS total_distance_m,
           COALESCE(SUM(a.moving_time), 0)          AS total_moving_time_sec,
           COALESCE(SUM(a.total_elevation_gain), 0) AS total_elevation_gain_m
         FROM activities a
         JOIN event_activities ea
           ON ea.strava_activity_id = a.strava_activity_id
          AND ea.event_id           = $2
         WHERE a.strava_id      = $1
           AND a.duplicate_of IS NULL
           AND a.start_date    <= (SELECT start_date FROM activities WHERE strava_activity_id = $3)
           AND a.start_date    >= $4::timestamptz`,
        [context.stravaId, context.eventId, context.activityId, context.eventStartDate]
      );

      const activeDaysResult = await query(
        `SELECT COUNT(*) AS active_days
         FROM (
           SELECT COALESCE(a.start_date_local, a.start_date)::date AS day
           FROM activities a
           JOIN event_activities ea
             ON ea.strava_activity_id = a.strava_activity_id
            AND ea.event_id           = $2
           WHERE a.strava_id      = $1
             AND a.duplicate_of IS NULL
             AND a.start_date    <= (SELECT start_date FROM activities WHERE strava_activity_id = $3)
             AND a.start_date    >= $4::timestamptz
           GROUP BY COALESCE(a.start_date_local, a.start_date)::date
           HAVING SUM(a.moving_time) >= $5
         ) active`,
        [context.stravaId, context.eventId, context.activityId, context.eventStartDate, ACTIVE_DAY_MIN_SEC]
      );

      const dayMovingTimeResult = await query(
        `SELECT COALESCE(SUM(a.moving_time), 0) AS day_moving_time_sec
         FROM activities a
         JOIN event_activities ea
           ON ea.strava_activity_id = a.strava_activity_id
          AND ea.event_id           = $2
         WHERE a.strava_id = $1
           AND a.duplicate_of IS NULL
           AND COALESCE(a.start_date_local, a.start_date)::date =
               (SELECT COALESCE(start_date_local, start_date)::date
                FROM activities WHERE strava_activity_id = $3)
           AND a.start_date <= (SELECT start_date FROM activities WHERE strava_activity_id = $3)`,
        [context.stravaId, context.eventId, context.activityId]
      );

      const goalsResult = await query(
        `SELECT goal_distance_km, goal_moving_time_sec
         FROM agenda_goals
         WHERE event_id = $1 AND strava_id = $2`,
        [context.eventId, context.stravaId]
      );

      const totals        = totalsResult.rows[0];
      const activeDays    = parseInt(activeDaysResult.rows[0].active_days);
      const dayMovingTime = parseFloat(dayMovingTimeResult.rows[0].day_moving_time_sec);
      const goals         = goalsResult.rows[0] || {};

      return {
        totalDistanceM:     parseFloat(totals.total_distance_m),
        totalMovingTimeSec: parseFloat(totals.total_moving_time_sec),
        totalElevationM:    parseFloat(totals.total_elevation_gain_m),
        activeDays,
        dayMovingTimeSec:   dayMovingTime,
        goalDistanceKm:     parseFloat(goals.goal_distance_km    || 0),
        goalMovingTimeSec:  parseFloat(goals.goal_moving_time_sec || 0),
      };
    },

    /**
     * Gera string do bloco de descrição.
     * activeDays é null se o dia ainda não atingiu 900s —
     * buildDescription omite a linha 🗓️ nesse caso.
     */
    build(data, context) {
      return buildDescription({
        totals: {
          totalDistanceM:     data.totalDistanceM,
          totalMovingTimeSec: data.totalMovingTimeSec,
          totalElevationM:    data.totalElevationM,
          activeDays:         data.dayMovingTimeSec >= ACTIVE_DAY_MIN_SEC ? data.activeDays : null,
          goalDistanceKm:     data.goalDistanceKm,
          goalMovingTimeSec:  data.goalMovingTimeSec,
        },
        context: {
          event: { name: context.eventName, goals: {} },
        },
      });
    },
  },

  camp: {
    /**
     * Orquestra match de sessão, acumulados, NP, FTP e IF.
     * Toda a lógica está em src/engine/modules/camp/index.js.
     */
    async consolidate(context) {
      return campConsolidate(context);
    },

    build(data, context) {
      return campBuildDescription({
        eventName:    context.eventName,
        totals:       data.totals,
        np:           data.np,
        npEstimated:  data.npEstimated,
        ifValue:      data.ifValue,
        ftpEstimated: data.ftpEstimated,
        tss:          data.tss,
        campTss:      data.campTss,
      });
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertAgendaDaily(stravaId, eventId, activityDate) {
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
       COALESCE(SUM(a.distance_m), 0)::integer,
       COALESCE(SUM(a.total_elevation_gain), 0)::integer,
       COALESCE(SUM(a.moving_time), 0)::integer,
       COALESCE(SUM(a.elapsed_time), 0)::integer,
       COALESCE(SUM(CASE WHEN a.commute = false THEN a.distance_m  ELSE 0 END), 0)::integer,
       COALESCE(SUM(CASE WHEN a.commute = true  THEN a.distance_m  ELSE 0 END), 0)::integer,
       COALESCE(SUM(CASE WHEN a.commute = false THEN a.moving_time ELSE 0 END), 0)::integer,
       COALESCE(SUM(CASE WHEN a.commute = true  THEN a.moving_time ELSE 0 END), 0)::integer
     FROM activities a
     JOIN event_activities ea
       ON ea.strava_activity_id = a.strava_activity_id
      AND ea.event_id = $1
     WHERE a.strava_id = $2
       AND a.duplicate_of IS NULL
       AND COALESCE(a.start_date_local, a.start_date)::date = $3::date
     ON CONFLICT (event_id, strava_id, activity_date) DO UPDATE SET
       total_distance_m       = EXCLUDED.total_distance_m,
       total_elevation_gain_m = EXCLUDED.total_elevation_gain_m,
       total_moving_time_sec  = EXCLUDED.total_moving_time_sec,
       total_elapsed_time_sec = EXCLUDED.total_elapsed_time_sec,
       treino_distance_m      = EXCLUDED.treino_distance_m,
       desloc_distance_m      = EXCLUDED.desloc_distance_m,
       treino_moving_time_sec = EXCLUDED.treino_moving_time_sec,
       desloc_moving_time_sec = EXCLUDED.desloc_moving_time_sec`,
    [eventId, stravaId, activityDate]
  );
}

async function sendPushNotification(eventId, eventName, stravaId) {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!appId || !apiKey) {
    console.log(`[Dispatcher] Push — variáveis ausentes`);
    return;
  }

  try {
    const result = await query(`SELECT slug FROM events WHERE id = $1`, [eventId]);
    if (result.rows.length === 0) {
      console.log(`[Dispatcher] Push — evento ${eventId} não encontrado`);
      return;
    }
    const slug = result.rows[0].slug;
    console.log(`[Dispatcher] Push — slug=${slug} strava_id=${stravaId}`);

    const pushRes = await fetch("https://onesignal.com/api/v1/notifications", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        app_id:   appId,
        headings: { en: eventName || "OGT Event Engine", pt: eventName || "OGT Event Engine" },
        contents: { en: "New activity processed.", pt: "Nova atividade processada e descrição atualizada." },
        filters:  [
          { field: "tag", key: `event_${slug}`, relation: "=", value: "true" },
          { operator: "AND" },
          { field: "tag", key: "strava_id", relation: "=", value: String(stravaId) },
        ],
      }),
    });
    const pushBody = await pushRes.text();
    console.log(`[Dispatcher] Push response ${pushRes.status}:`, pushBody);
  } catch (err) {
    console.error("[Dispatcher] Erro ao enviar push:", err);
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

/**
 * POST /api/internal/module-dispatcher
 *
 * Chamado pelo worker após coleta e persistência dos dados brutos.
 * Responsabilidades:
 *   1. Buscar event_activities pendentes (processed = false)
 *   2. Para cada evento: consolidate → build → coleta moduleOutputs
 *   3. mergeDescription + PUT Strava
 *   4. upsertAgendaDaily
 *   5. Marcar event_activities.processed = true
 *   6. Atualizar engine_last_put_at
 *   7. Push notification (fire-and-forget)
 *
 * Body: { strava_activity_id, strava_id }
 * Retorna: { ok: true, processed: N } ou { ok: false, reason }
 */
export async function POST(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${process.env.INTERNAL_WORKER_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { strava_activity_id: activityId, strava_id: stravaId } = await request.json();

  if (!activityId || !stravaId) {
    return NextResponse.json(
      { ok: false, reason: "strava_activity_id e strava_id são obrigatórios" },
      { status: 400 }
    );
  }

  try {
    // ── Buscar activity no banco ──────────────────────────
    const actResult = await query(
      `SELECT last_webhook_aspect,
              TO_CHAR(COALESCE(start_date_local, start_date), 'YYYY-MM-DD HH24:MI:SS') AS start_date_local_str,
              TO_CHAR(COALESCE(start_date_local, start_date), 'YYYY-MM-DD')            AS activity_date_str
       FROM activities WHERE strava_activity_id = $1`,
      [activityId]
    );

    if (actResult.rows.length === 0) {
      return NextResponse.json({ ok: false, reason: "activity_not_found" });
    }
    if (actResult.rows[0].last_webhook_aspect === "delete") {
      return NextResponse.json({ ok: true, reason: "delete_skipped", processed: 0 });
    }

    const activityDate = actResult.rows[0].activity_date_str;

    // ── Buscar event_activities pendentes ────────────────
    const pendingResult = await query(
      `SELECT ea.event_id,
              e.name                              AS event_name,
              TO_CHAR(e.start_date, 'YYYY-MM-DD') AS event_start_date,
              TO_CHAR(e.end_date,   'YYYY-MM-DD') AS event_end_date,
              m.slug                              AS module_slug,
              ec.metadata->>'accepted_sport_types' AS accepted_sport_types_json
       FROM event_activities ea
       JOIN events  e  ON e.id  = ea.event_id
       JOIN modules m  ON m.id  = e.module_id
       LEFT JOIN event_configs ec ON ec.event_id = e.id
       WHERE ea.strava_activity_id = $1
         AND ea.processed          = false
         AND e.is_active           = true
         AND m.is_active           = true
         AND (e.end_date IS NULL OR $2::date <= e.end_date)`,
      [activityId, activityDate]
    );

    if (pendingResult.rows.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, reason: "nothing_pending" });
    }

    // ── Buscar sport_type do Strava ───────────────────────
    const token     = await getValidAccessToken(stravaId);
    const stravaRes = await fetch(`${STRAVA_API}/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!stravaRes.ok) {
      return NextResponse.json({ ok: false, reason: `strava_fetch_${stravaRes.status}` });
    }

    const stravaActivity      = await stravaRes.json();
    const originalDescription = stravaActivity.description || "";
    const sportType           = stravaActivity.sport_type;

    // ── Processar cada evento ─────────────────────────────
    const moduleOutputs   = [];
    const processedEvents = [];

    for (const row of pendingResult.rows) {
      const reg = MODULE_REGISTRY[row.module_slug];

      if (!reg) {
        console.warn(`[Dispatcher] Módulo não registrado: ${row.module_slug}`);
        continue;
      }

      // accepted_sport_types vem de event_configs.metadata (ADR-010)
      const acceptedSportTypes = row.accepted_sport_types_json
        ? JSON.parse(row.accepted_sport_types_json)
        : null;

      if (acceptedSportTypes && !acceptedSportTypes.includes(sportType)) {
        // Sport não aceito — marca como processado sem gerar bloco
        await query(
          `UPDATE event_activities SET processed = true
           WHERE event_id = $1 AND strava_activity_id = $2`,
          [row.event_id, activityId]
        );
        continue;
      }

      const context = {
        stravaId,
        activityId,
        eventId:        row.event_id,
        eventName:      row.event_name,
        eventStartDate: row.event_start_date,
        eventEndDate:   row.event_end_date,
        startDateLocal: actResult.rows[0].start_date_local_str,
      };

      try {
        const data = await reg.consolidate(context);

        // null = módulo decidiu que esta atividade não se aplica (ex: camp sem match de sessão)
        if (data === null) {
          await query(
            `UPDATE event_activities SET processed = true
             WHERE event_id = $1 AND strava_activity_id = $2`,
            [row.event_id, activityId]
          );
          continue;
        }

        const block = reg.build(data, context);

        if (block) moduleOutputs.push(block);
        processedEvents.push(row.event_id);

      } catch (err) {
        console.error(`[Dispatcher] Erro módulo ${row.module_slug} event ${row.event_id}:`, err);
        // Não marca como processado — worker fará retry via fila
        return NextResponse.json({ ok: false, reason: err.message });
      }
    }

    // ── mergeDescription + PUT Strava ─────────────────────
    if (moduleOutputs.length > 0) {
      const merged = mergeDescription(originalDescription, moduleOutputs);

      if (merged !== null) {
        const putRes = await fetch(`${STRAVA_API}/activities/${activityId}`, {
          method: "PUT",
          headers: {
            Authorization:  `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description: merged }),
        });

        if (!putRes.ok) {
          const body = await putRes.text();
          console.error(`[Dispatcher] PUT ${activityId} falhou:`, putRes.status, body);
          return NextResponse.json({ ok: false, reason: `strava_put_${putRes.status}` });
        }

        await query(
          `UPDATE activities SET engine_last_put_at = NOW()
           WHERE strava_activity_id = $1`,
          [activityId]
        );

        // ── Upsert agenda_daily ───────────────────────────
        for (const eventId of processedEvents) {
          await upsertAgendaDaily(stravaId, eventId, activityDate);
        }

        // ── Push notification ────────────────────────────
        for (const eventId of processedEvents) {
          await sendPushNotification(
            eventId,
            pendingResult.rows.find(r => r.event_id === eventId)?.event_name || "",
            stravaId
          );
        }
      }
    }

    // ── Marcar event_activities como processado ───────────
    for (const eventId of processedEvents) {
      await query(
        `UPDATE event_activities SET processed = true
         WHERE event_id = $1 AND strava_activity_id = $2`,
        [eventId, activityId]
      );
    }

    return NextResponse.json({ ok: true, processed: processedEvents.length });

  } catch (err) {
    console.error("[Dispatcher] Erro geral:", err);
    return NextResponse.json({ ok: false, reason: err.message }, { status: 500 });
  }
}
