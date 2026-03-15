import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getValidAccessToken } from "@/lib/strava";
import { mergeDescription } from "@/engine/mergeDescription";

// Módulos registrados
import { ACCEPTED_SPORT_TYPES } from "@/engine/modules/agenda/index.js";
import { buildDescription }     from "@/engine/modules/agenda/buildDescription.js";

export const runtime     = "nodejs";
export const maxDuration = 60;

const STRAVA_API         = "https://www.strava.com/api/v3";
const ACTIVE_DAY_MIN_SEC = 900; // 15 minutos

/**
 * ============================================================
 * MODULE REGISTRY
 * ============================================================
 *
 * Registra módulos ativos e seus contratos:
 *   consolidate(context) → dados para os builders
 *   build(data, context) → descriptionBlock string
 *   acceptedSportTypes   → filtra antes de processar
 *
 * Para adicionar um novo módulo: adicionar entrada aqui.
 * O dispatcher não precisa ser alterado.
 * ============================================================
 */
const MODULE_REGISTRY = {
  agenda: {
    acceptedSportTypes: ACCEPTED_SPORT_TYPES,

    /**
     * Consolida dados diretamente de activities para a atividade X.
     *
     * Cada atividade é processada de forma independente e retroativamente
     * ignorante — nunca sabe de atividades com start_date posterior.
     *
     * Acumulado (distância, tempo, elevação):
     *   Soma de todas as atividades aceitas com start_date <= start_date de X.
     *
     * Dias ativos:
     *   Dias onde SUM(moving_time) das atividades com start_date <= start_date de X >= 900s.
     *
     * dayMovingTimeSec:
     *   Soma do moving_time do dia de X, apenas para atividades com
     *   start_date <= start_date de X. Usado para decidir se exibe a
     *   linha de dias ativos no bloco.
     */
    async consolidate(context) {
      // ── Totais acumulados até e incluindo a atividade X ──
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
        [
          context.stravaId,
          context.eventId,
          context.activityId,
          context.eventStartDate,
        ]
      );

      // ── Dias ativos até e incluindo o dia de X ────────────
      // Considera apenas atividades com start_date <= start_date de X
      const activeDaysResult = await query(
        `SELECT COUNT(*) AS active_days
         FROM (
           SELECT a.start_date::date AS day
           FROM activities a
           JOIN event_activities ea
             ON ea.strava_activity_id = a.strava_activity_id
            AND ea.event_id           = $2
           WHERE a.strava_id      = $1
             AND a.duplicate_of IS NULL
             AND a.start_date    <= (SELECT start_date FROM activities WHERE strava_activity_id = $3)
             AND a.start_date    >= $4::timestamptz
           GROUP BY a.start_date::date
           HAVING SUM(a.moving_time) >= $5
         ) active`,
        [
          context.stravaId,
          context.eventId,
          context.activityId,
          context.eventStartDate,
          ACTIVE_DAY_MIN_SEC,
        ]
      );

      // ── Moving time do dia de X até e incluindo X ─────────
      // Soma apenas atividades com start_date <= start_date de X
      // no mesmo dia — para decidir se exibe linha de dias ativos
      const dayMovingTimeResult = await query(
        `SELECT COALESCE(SUM(a.moving_time), 0) AS day_moving_time_sec
         FROM activities a
         JOIN event_activities ea
           ON ea.strava_activity_id = a.strava_activity_id
          AND ea.event_id           = $2
         WHERE a.strava_id          = $1
           AND a.duplicate_of IS NULL
           AND a.start_date::date   = (SELECT start_date::date FROM activities WHERE strava_activity_id = $3)
           AND a.start_date        <= (SELECT start_date        FROM activities WHERE strava_activity_id = $3)`,
        [
          context.stravaId,
          context.eventId,
          context.activityId,
        ]
      );

      // ── Metas do atleta ───────────────────────────────────
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
        goalDistanceKm:     parseFloat(goals.goal_distance_km     || 0),
        goalMovingTimeSec:  parseFloat(goals.goal_moving_time_sec  || 0),
      };
    },

    /**
     * Gera bloco de descrição a partir dos dados consolidados.
     *
     * activeDays é passado como null se o dia ainda não atingiu 900s
     * até esta atividade — buildDescription omite a linha 🗓️ nesse caso.
     * O bloco é sempre gerado.
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
          event: {
            name:  context.eventName,
            goals: {},
          },
        },
      });
    },
  },
};

/**
 * ============================================================
 * POST /api/internal/module-dispatcher
 * ============================================================
 *
 * Chamado pelo worker após coleta de dados brutos.
 * Responsabilidades:
 *   1. Buscar event_activities pendentes para a atividade
 *   2. Para cada evento:
 *      a. consolidate() → acumulado até esta atividade direto de activities
 *      b. build()       → gera descriptionBlock
 *   3. mergeDescription → PUT Strava
 *   4. Atualizar metadata em event_activities
 *   5. Atualizar engine_last_put_at em activities
 *
 * Body: { strava_activity_id, strava_id }
 * ============================================================
 */
export async function POST(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${process.env.INTERNAL_WORKER_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { strava_activity_id: activityId, strava_id: stravaId } = await request.json();

  if (!activityId || !stravaId) {
    return NextResponse.json({ error: "strava_activity_id e strava_id são obrigatórios" }, { status: 400 });
  }

  try {
    // ── Buscar activity no banco ──────────────────────────
    const actResult = await query(
      `SELECT last_webhook_aspect
       FROM activities WHERE strava_activity_id = $1`,
      [activityId]
    );

    if (actResult.rows.length === 0) {
      return NextResponse.json({ ok: false, reason: "activity_not_found" });
    }
    if (actResult.rows[0].last_webhook_aspect === "delete") {
      return NextResponse.json({ ok: true, reason: "delete_skipped" });
    }

    // ── Buscar sport_type no Strava ───────────────────────
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

    // ── event_activities pendentes para esta atividade ───
    const pendingResult = await query(
      `SELECT ea.event_id,
              e.name                              AS event_name,
              TO_CHAR(e.start_date, 'YYYY-MM-DD') AS event_start_date,
              TO_CHAR(e.end_date,   'YYYY-MM-DD') AS event_end_date,
              m.slug                              AS module_slug
       FROM event_activities ea
       JOIN events  e ON e.id  = ea.event_id
       JOIN modules m ON m.id  = e.module_id
       WHERE ea.strava_activity_id = $1
         AND ea.processed          = false
         AND e.is_active           = true
         AND m.is_active           = true`,
      [activityId]
    );

    if (pendingResult.rows.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, reason: "nothing_pending" });
    }

    // ── Processar cada evento ─────────────────────────────
    const moduleOutputs   = [];
    const processedEvents = [];

    for (const row of pendingResult.rows) {
      const reg = MODULE_REGISTRY[row.module_slug];

      if (!reg) {
        console.warn(`[Dispatcher] Módulo não registrado: ${row.module_slug}`);
        continue;
      }

      if (reg.acceptedSportTypes && !reg.acceptedSportTypes.includes(sportType)) {
        await markProcessed(row.event_id, activityId, row.module_slug);
        continue;
      }

      const context = {
        stravaId,
        activityId,
        eventId:            row.event_id,
        eventName:          row.event_name,
        eventStartDate:     row.event_start_date,
        eventEndDate:       row.event_end_date,
        acceptedSportTypes: reg.acceptedSportTypes,
      };

      try {
        const data  = await reg.consolidate(context);
        const block = reg.build(data, context);

        if (block) moduleOutputs.push(block);

        await markProcessed(row.event_id, activityId, row.module_slug);
        processedEvents.push(row.event_id);

      } catch (err) {
        console.error(`[Dispatcher] Erro módulo ${row.module_slug} event ${row.event_id}:`, err);
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
        // start_date_local vem do Strava com o offset do local
        // da atividade — garante atribuição correta do dia.
        const activityDate = (stravaActivity.start_date_local || stravaActivity.start_date).slice(0, 10);

        for (const eventId of processedEvents) {
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

        for (const eventId of processedEvents) {
          sendPushNotification(
            eventId,
            pendingResult.rows.find(r => r.event_id === eventId)?.event_name || ""
          );
        }
      }
    }

    if (processedEvents.length > 0) {
      for (const eventId of processedEvents) {
        await query(
          `UPDATE event_activities SET processed = true
           WHERE event_id = $1 AND strava_activity_id = $2`,
          [eventId, activityId]
        );
      }
    }

    return NextResponse.json({
      ok:        true,
      processed: processedEvents.length,
      outputs:   moduleOutputs.length,
    });

  } catch (err) {
    console.error("[Dispatcher] Erro geral:", err);
    return NextResponse.json({ error: "Dispatcher failed", detail: err.message }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function markProcessed(eventId, activityId, moduleSlug) {
  await query(
    `UPDATE event_activities
     SET metadata = COALESCE(metadata, '{}') || $1::jsonb
     WHERE event_id = $2 AND strava_activity_id = $3`,
    [JSON.stringify({ [moduleSlug]: true }), eventId, activityId]
  );
}

function sendPushNotification(eventId, eventName) {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!appId || !apiKey) return;

  query(`SELECT slug FROM events WHERE id = $1`, [eventId])
    .then(result => {
      if (result.rows.length === 0) return;
      const slug = result.rows[0].slug;

      fetch("https://onesignal.com/api/v1/notifications", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Basic ${apiKey}`,
        },
        body: JSON.stringify({
          app_id:   appId,
          headings: { pt: eventName || "OGT Event Engine" },
          contents: { pt: "Nova atividade processada e descrição atualizada." },
          filters:  [
            { field: "tag", key: `event_${slug}`, relation: "=", value: "true" },
          ],
        }),
      }).catch(err => console.error("[Dispatcher] Erro ao enviar push:", err));
    })
    .catch(err => console.error("[Dispatcher] Erro ao buscar slug para push:", err));
}
