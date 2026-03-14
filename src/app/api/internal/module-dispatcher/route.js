import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getValidAccessToken } from "@/lib/strava";
import { mergeDescription } from "@/engine/mergeDescription";

// Módulos registrados
import { ACCEPTED_SPORT_TYPES } from "@/engine/modules/agenda/index.js";
import { computeTotals }        from "@/engine/modules/agenda/computeTotals.js";
import { buildDescription }     from "@/engine/modules/agenda/buildDescription.js";

export const runtime     = "nodejs";
export const maxDuration = 60;

const STRAVA_API = "https://www.strava.com/api/v3";

/**
 * ============================================================
 * MODULE REGISTRY
 * ============================================================
 *
 * Registra módulos ativos e seus contratos:
 *   prepare(context)     → atualiza dados derivados antes do consolidate
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
     * Recalcula agenda_daily para o dia da atividade.
     * Garante que a consolidação reflita dados atualizados
     * mesmo para atividades recebidas via webhook (não backfill).
     */
    async prepare(context) {
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
         WHERE strava_id  = $2
           AND start_date::date = $3::date
           AND duplicate_of IS NULL
         ON CONFLICT (event_id, strava_id, activity_date) DO UPDATE SET
           total_distance_m       = EXCLUDED.total_distance_m,
           total_elevation_gain_m = EXCLUDED.total_elevation_gain_m,
           total_moving_time_sec  = EXCLUDED.total_moving_time_sec,
           total_elapsed_time_sec = EXCLUDED.total_elapsed_time_sec,
           treino_distance_m      = EXCLUDED.treino_distance_m,
           desloc_distance_m      = EXCLUDED.desloc_distance_m,
           treino_moving_time_sec = EXCLUDED.treino_moving_time_sec,
           desloc_moving_time_sec = EXCLUDED.desloc_moving_time_sec`,
        [context.eventId, context.stravaId, context.activityDate]
      );
    },

    /**
     * Consolida dados do banco para o módulo.
     * endDate = activityDate → acumulado até o dia da atividade,
     * não até o fim do evento.
     */
    async consolidate(context) {
      const result = await query(
        `SELECT
           d.activity_date,
           d.total_distance_m,
           d.total_elevation_gain_m,
           d.total_moving_time_sec,
           d.total_elapsed_time_sec,
           d.treino_distance_m,
           d.desloc_distance_m,
           d.treino_moving_time_sec,
           d.desloc_moving_time_sec,
           g.goal_distance_km,
           g.goal_moving_time_sec
         FROM agenda_daily d
         LEFT JOIN agenda_goals g
           ON g.event_id = d.event_id AND g.strava_id = d.strava_id
         WHERE d.event_id      = $1
           AND d.strava_id     = $2
           AND d.activity_date >= $3
           AND d.activity_date <= $4
         ORDER BY d.activity_date`,
        [context.eventId, context.stravaId, context.startDate, context.activityDate]
      );
      return { daily: result.rows };
    },

    // Gera bloco de descrição
    build(data, context) {
      const totals = computeTotals(data);
      return buildDescription({
        totals,
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
 *      a. prepare()     → atualiza agenda_daily para o dia da atividade
 *      b. consolidate() → lê dados acumulados até o dia da atividade
 *      c. build()       → gera descriptionBlock
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
    // last_webhook_aspect = 'delete' → nada a processar
    const actResult = await query(
      `SELECT last_webhook_aspect, start_date::date AS activity_date
       FROM activities WHERE strava_activity_id = $1`,
      [activityId]
    );

    if (actResult.rows.length === 0) {
      return NextResponse.json({ ok: false, reason: "activity_not_found" });
    }
    if (actResult.rows[0].last_webhook_aspect === "delete") {
      return NextResponse.json({ ok: true, reason: "delete_skipped" });
    }

    const activityDate = actResult.rows[0].activity_date; // 'YYYY-MM-DD'

    // ── Buscar sport_type no Strava ───────────────────────
    // Necessário para filtrar por ACCEPTED_SPORT_TYPES.
    // Token com refresh automático.
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
      `SELECT ea.event_id, ea.metadata,
              e.name AS event_name, e.start_date, e.end_date,
              m.slug AS module_slug
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

      // Filtrar sport_type
      if (reg.acceptedSportTypes && !reg.acceptedSportTypes.includes(sportType)) {
        // Marca como processado mesmo assim — não há o que fazer com esse sport
        await markProcessed(row.event_id, activityId, row.module_slug);
        continue;
      }

      const context = {
        stravaId,
        eventId:      row.event_id,
        eventName:    row.event_name,
        startDate:    row.start_date,
        endDate:      row.end_date,
        activityDate,           // data da atividade — usado como teto do consolidate
      };

      try {
        // a. Atualiza agenda_daily para o dia da atividade
        if (reg.prepare) {
          await reg.prepare(context);
        }

        // b. Consolida dados acumulados até o dia da atividade
        const data  = await reg.consolidate(context);

        // c. Gera bloco de descrição
        const block = reg.build(data, context);

        if (block) {
          moduleOutputs.push(block);
        }

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

        // Atualizar loop guard
        await query(
          `UPDATE activities SET engine_last_put_at = NOW()
           WHERE strava_activity_id = $1`,
          [activityId]
        );

        // ── Notificação push ──────────────────────────────
        for (const eventId of processedEvents) {
          sendPushNotification(eventId, pendingResult.rows.find(r => r.event_id === eventId)?.event_name || "");
        }
      }
    }

    // Marcar event_activities.processed = true
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

/**
 * Marca módulo como processado no metadata de event_activities.
 * { agenda: true } — extensível para múltiplos módulos por evento.
 */
async function markProcessed(eventId, activityId, moduleSlug) {
  await query(
    `UPDATE event_activities
     SET metadata = COALESCE(metadata, '{}') || $1::jsonb
     WHERE event_id = $2 AND strava_activity_id = $3`,
    [JSON.stringify({ [moduleSlug]: true }), eventId, activityId]
  );
}

/**
 * Dispara notificação push via OneSignal REST API.
 * Segmenta por tag event_<slug> — apenas atletas com opt-in ativo recebem.
 * Fire-and-forget: erros são logados mas não afetam o fluxo principal.
 */
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
