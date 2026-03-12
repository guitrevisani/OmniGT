import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getValidAccessToken } from "@/lib/strava";
import { runModule } from "@/engine/moduleRunner";
import { mergeDescription } from "@/engine/mergeDescription";

import { ACCEPTED_SPORT_TYPES as agendaAccepted, REPROCESS_ON_DELETE as agendaReprocess } from "@/engine/modules/agenda/index.js";
import { computeTotals }      from "@/engine/modules/agenda/computeTotals.js";
import { buildDescription }   from "@/engine/modules/agenda/buildDescription.js";

export const runtime    = "nodejs";
export const maxDuration = 60;

const STRAVA_API = "https://www.strava.com/api/v3";

/**
 * MODULE_REGISTRY
 *
 * Registra módulos ativos na engine.
 * Cada entrada expõe:
 *   module      → o index.js do módulo (ACCEPTED_SPORT_TYPES, REPROCESS_ON_DELETE, etc.)
 *   consolidate → função que lê o banco e retorna dados para os builders
 *   builders    → { buildDescription, computeTotals, ... }
 *
 * Módulos sem buildDescription (isRegistration: true) são ignorados no worker.
 */
const MODULE_REGISTRY = {
  agenda: {
    acceptedSportTypes:  agendaAccepted,
    reprocessOnDelete:   agendaReprocess,
    isRegistration:      false,
    consolidate: (context) => computeTotals(context),
    builders:    { buildDescription },
  },
  // estimator: sem entrada — isRegistration: true, não gera bloco de descrição
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detecta duplicata por heurística:
 *   - mesmo strava_id
 *   - start_date ±5min
 *   - device_name diferente
 *   - end_date ±5min  (start + elapsed_time)
 *   - moving_time similar ±10%
 *
 * Retorna o strava_activity_id da atividade original (a de maior moving_time),
 * ou null se não for duplicata.
 */
async function detectDuplicate(stravaId, startDate, elapsedTime, movingTime, deviceName, currentActivityId) {
  if (!deviceName) return null;

  const endDate   = new Date(new Date(startDate).getTime() + elapsedTime * 1000);
  const tolerance = 5 * 60 * 1000; // 5 min em ms

  const result = await query(
    `SELECT strava_activity_id, moving_time, elapsed_time, device_name
     FROM activities
     WHERE strava_id       = $1
       AND strava_activity_id <> $2
       AND duplicate_of IS NULL
       AND ABS(EXTRACT(EPOCH FROM (start_date - $3::timestamp)) * 1000) <= $4
       AND device_name IS NOT NULL
       AND device_name <> $5`,
    [stravaId, currentActivityId, startDate, tolerance, deviceName]
  );

  if (result.rows.length === 0) return null;

  for (const candidate of result.rows) {
    // Verificar end_date ±5min
    const candEnd = new Date(
      new Date(candidate.start_date || startDate).getTime() +
      Number(candidate.elapsed_time) * 1000
    );
    if (Math.abs(candEnd - endDate) > tolerance) continue;

    // Verificar moving_time ±10%
    const ratio = Math.max(movingTime, candidate.moving_time) /
                  Math.min(movingTime, candidate.moving_time);
    if (ratio > 1.1) continue;

    // É duplicata — retorna o de maior moving_time como original
    if (candidate.moving_time >= movingTime) {
      return candidate.strava_activity_id; // atual é duplicata do candidato
    } else {
      // Candidato é duplicata do atual — marca o candidato
      await query(
        `UPDATE activities SET duplicate_of = $1 WHERE strava_activity_id = $2`,
        [currentActivityId, candidate.strava_activity_id]
      );
      return null; // atual é o original
    }
  }

  return null;
}

/**
 * Busca e registra gear em athlete_gears.
 * Só chama a API do Strava se o gear ainda não existe no banco.
 */
async function upsertGear(gearId, stravaId, token) {
  if (!gearId) return;

  const existing = await query(
    `SELECT gear_id FROM athlete_gears WHERE gear_id = $1`,
    [gearId]
  );
  if (existing.rows.length > 0) return;

  try {
    const res = await fetch(`${STRAVA_API}/gear/${gearId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const gear = await res.json();

    // frame_type presente → bike; ausente → shoe
    const type = gear.frame_type != null ? "bike" : "shoe";

    await query(
      `INSERT INTO athlete_gears (gear_id, strava_id, name, type)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (gear_id) DO NOTHING`,
      [gearId, stravaId, gear.name || gearId, type]
    );
  } catch (err) {
    console.error(`[Worker] Erro ao buscar gear ${gearId}:`, err.message);
  }
}

/**
 * Reenfileira atividades de um atleta num evento a partir de uma data.
 * Usado no DELETE com REPROCESS_ON_DELETE = true.
 * Sem delay — não é edição do atleta.
 */
async function reprocessFromDate(stravaId, eventId, fromDate) {
  await query(
    `INSERT INTO activity_processing_queue (strava_activity_id, next_run_at)
     SELECT ea.strava_activity_id, NOW()
     FROM event_activities ea
     JOIN activities a ON a.strava_activity_id = ea.strava_activity_id
     WHERE ea.event_id   = $1
       AND a.strava_id   = $2
       AND a.start_date >= $3
       AND a.duplicate_of IS NULL
     ON CONFLICT (strava_activity_id) DO UPDATE SET next_run_at = NOW()`,
    [eventId, stravaId, fromDate]
  );
}

async function removeFromQueue(activityId) {
  await query(
    `DELETE FROM activity_processing_queue WHERE strava_activity_id = $1`,
    [activityId]
  );
}

// ─── Handler principal ────────────────────────────────────────────────────────

/**
 * POST /api/internal/strava-worker
 *
 * Chamado pelo webhook (fire-and-forget) e/ou por cron.
 * Processa todos os itens da queue com next_run_at <= now().
 *
 * Para cada activity_id:
 *   CREATE/UPDATE → detecta duplicata → upsert gear → roda módulos → merge → PUT Strava
 *   DELETE        → cascata se REPROCESS_ON_DELETE → remove do banco
 */
export async function POST(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${process.env.INTERNAL_WORKER_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const processed = [], skipped = [], errors = [];

  try {
    const queueResult = await query(
      `SELECT strava_activity_id FROM activity_processing_queue
       WHERE next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 20`
    );

    if (queueResult.rows.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, message: "Queue vazia" });
    }

    for (const row of queueResult.rows) {
      const activityId = row.strava_activity_id;

      try {
        // ── Buscar activity no banco ────────────────────────
        const actResult = await query(
          `SELECT strava_activity_id, strava_id, start_date, moving_time,
                  elapsed_time, device_name, gear_id, last_webhook_aspect
           FROM activities
           WHERE strava_activity_id = $1`,
          [activityId]
        );

        if (actResult.rows.length === 0) {
          // Activity não existe ainda — mantém na queue, tenta depois
          skipped.push({ activityId, reason: "activity_not_in_db" });
          continue;
        }

        const act      = actResult.rows[0];
        const stravaId = act.strava_id;

        // ── DELETE ──────────────────────────────────────────
        if (act.last_webhook_aspect === "delete") {
          // Buscar eventos ativos deste atleta antes de deletar
          const eventsResult = await query(
            `SELECT e.id AS event_id, m.slug AS module_slug
             FROM athlete_events ae
             JOIN events e ON e.id = ae.event_id
             JOIN modules m ON m.id = e.module_id
             WHERE ae.strava_id = $1 AND ae.status = 'active' AND e.is_active = true`,
            [stravaId]
          );

          for (const event of eventsResult.rows) {
            const reg = MODULE_REGISTRY[event.module_slug];
            if (reg?.reprocessOnDelete) {
              await reprocessFromDate(stravaId, event.event_id, act.start_date);
            }
          }

          // Remover activity do banco
          await query(
            `DELETE FROM event_module_processing WHERE strava_activity_id = $1`,
            [activityId]
          );
          await query(
            `DELETE FROM event_activities WHERE strava_activity_id = $1`,
            [activityId]
          );
          await query(
            `DELETE FROM activities WHERE strava_activity_id = $1`,
            [activityId]
          );
          await removeFromQueue(activityId);
          processed.push({ activityId, action: "deleted" });
          continue;
        }

        // ── Buscar eventos ativos do atleta ─────────────────
        const eventsResult = await query(
          `SELECT e.id AS event_id, e.name AS event_name, m.slug AS module_slug,
                  ec.metadata AS config
           FROM athlete_events ae
           JOIN events e ON e.id = ae.event_id
           JOIN modules m ON m.id = e.module_id
           LEFT JOIN event_configs ec ON ec.event_id = e.id
           WHERE ae.strava_id = $1
             AND ae.status = 'active'
             AND e.is_active = true
             AND m.is_active = true`,
          [stravaId]
        );

        if (eventsResult.rows.length === 0) {
          await removeFromQueue(activityId);
          skipped.push({ activityId, reason: "no_active_events" });
          continue;
        }

        // ── Token válido ────────────────────────────────────
        const token = await getValidAccessToken(stravaId);

        // ── Dados frescos do Strava ─────────────────────────
        const stravaRes = await fetch(`${STRAVA_API}/activities/${activityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!stravaRes.ok) {
          errors.push({ activityId, reason: `strava_fetch_${stravaRes.status}` });
          continue;
        }

        const stravaActivity = await stravaRes.json();

        // ── Upsert gear ─────────────────────────────────────
        if (stravaActivity.gear_id) {
          await upsertGear(stravaActivity.gear_id, stravaId, token);
          // Atualizar gear_id na activity se mudou
          if (stravaActivity.gear_id !== act.gear_id) {
            await query(
              `UPDATE activities SET gear_id = $1 WHERE strava_activity_id = $2`,
              [stravaActivity.gear_id, activityId]
            );
          }
        }

        // ── Detecção de duplicata ───────────────────────────
        const duplicateOf = await detectDuplicate(
          stravaId,
          stravaActivity.start_date,
          stravaActivity.elapsed_time,
          stravaActivity.moving_time,
          stravaActivity.device_name,
          activityId
        );

        if (duplicateOf) {
          await query(
            `UPDATE activities SET duplicate_of = $1 WHERE strava_activity_id = $2`,
            [duplicateOf, activityId]
          );
          await removeFromQueue(activityId);
          skipped.push({ activityId, reason: "duplicate", duplicate_of: duplicateOf });
          continue;
        }

        // ── Processar módulos ───────────────────────────────
        const moduleOutputs = [];

        for (const event of eventsResult.rows) {
          const reg = MODULE_REGISTRY[event.module_slug];

          if (!reg) continue;
          if (reg.isRegistration) continue;

          // Verificar sport_type aceito
          if (reg.acceptedSportTypes &&
              !reg.acceptedSportTypes.includes(stravaActivity.sport_type)) {
            skipped.push({ activityId, reason: `sport_not_accepted:${stravaActivity.sport_type}` });
            continue;
          }

          const context = {
            stravaId,
            eventId:   event.event_id,
            eventName: event.event_name,
            config:    event.config || {},
          };

          try {
            const result = await runModule({
              moduleName:  event.module_slug,
              context,
              consolidate: reg.consolidate,
              builders:    reg.builders,
            });

            if (result.descriptionBlock) {
              moduleOutputs.push({
                eventName: event.event_name,
                block:     result.descriptionBlock,
              });
            }

            await query(
              `INSERT INTO event_module_processing
                 (event_id, strava_activity_id, module_id, processed_at)
               SELECT $1, $2, m.id, NOW()
               FROM modules m WHERE m.slug = $3
               ON CONFLICT (event_id, strava_activity_id, module_id)
               DO UPDATE SET processed_at = NOW()`,
              [event.event_id, activityId, event.module_slug]
            );

          } catch (moduleErr) {
            console.error(`[Worker] Módulo ${event.module_slug} activity ${activityId}:`, moduleErr);
            errors.push({ activityId, module: event.module_slug, error: moduleErr.message });
          }
        }

        // ── Merge + PUT Strava ──────────────────────────────
        if (moduleOutputs.length > 0) {
          const merged = mergeDescription(
            stravaActivity.description || "",
            moduleOutputs
          );

          if (merged !== null) {
            const putRes = await fetch(`${STRAVA_API}/activities/${activityId}`, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ description: merged }),
            });

            if (!putRes.ok) {
              const body = await putRes.text();
              console.error(`[Worker] PUT ${activityId} falhou:`, putRes.status, body);
              errors.push({ activityId, reason: `strava_put_${putRes.status}` });
              continue;
            }

            await query(
              `UPDATE activities SET engine_last_put_at = NOW()
               WHERE strava_activity_id = $1`,
              [activityId]
            );
          }
        }

        await removeFromQueue(activityId);
        processed.push({ activityId, action: "processed" });

      } catch (actErr) {
        console.error(`[Worker] Erro activity ${activityId}:`, actErr);
        errors.push({ activityId, error: actErr.message });
      }
    }

    return NextResponse.json({
      ok:         true,
      elapsed_ms: Date.now() - started,
      processed:  processed.length,
      skipped:    skipped.length,
      errors:     errors.length,
      detail:     { processed, skipped, errors },
    });

  } catch (err) {
    console.error("[Worker] Erro geral:", err);
    return NextResponse.json({ error: "Worker failed", detail: err.message }, { status: 500 });
  }
}
