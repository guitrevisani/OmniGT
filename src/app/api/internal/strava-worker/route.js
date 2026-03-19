import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getValidAccessToken } from "@/lib/strava";

import { REPROCESS_ON_DELETE } from "@/engine/modules/agenda/index.js";

export const runtime     = "nodejs";
export const maxDuration = 60;

const STRAVA_API = "https://www.strava.com/api/v3";

const MODULE_REGISTRY = {
  agenda: { reprocessOnDelete: REPROCESS_ON_DELETE },
  camp:   { reprocessOnDelete: true },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decide se atividades posteriores devem ser reprocessadas.
 *
 * Regras:
 *   create → sempre reprocessa (atividade nova pode ter inserção fora de ordem)
 *   update → só reprocessa se `type` mudou (altera accepted_sport_types)
 *   delete → tratado separadamente antes de chegar aqui
 */
function shouldReprocessPosterior(aspectType, webhookUpdates) {
  if (aspectType === 'create') return true;
  if (aspectType === 'update') {
    return webhookUpdates?.type != null;
  }
  return false;
}

async function detectDuplicate(stravaId, startDate, elapsedTime, movingTime, deviceName, currentActivityId) {
  if (!deviceName) return null;

  const endDate   = new Date(new Date(startDate).getTime() + elapsedTime * 1000);
  const tolerance = 5 * 60 * 1000;

  const result = await query(
    `SELECT strava_activity_id, moving_time, elapsed_time, device_name
     FROM activities
     WHERE strava_id           = $1
       AND strava_activity_id <> $2
       AND duplicate_of IS NULL
       AND ABS(EXTRACT(EPOCH FROM (start_date - $3::timestamp)) * 1000) <= $4
       AND device_name IS NOT NULL
       AND device_name <> $5`,
    [stravaId, currentActivityId, startDate, tolerance, deviceName]
  );

  if (result.rows.length === 0) return null;

  for (const candidate of result.rows) {
    const candEnd = new Date(
      new Date(candidate.start_date || startDate).getTime() +
      Number(candidate.elapsed_time) * 1000
    );
    if (Math.abs(candEnd - endDate) > tolerance) continue;

    const ratio = Math.max(movingTime, candidate.moving_time) /
                  Math.min(movingTime, candidate.moving_time);
    if (ratio > 1.1) continue;

    if (candidate.moving_time >= movingTime) {
      return candidate.strava_activity_id;
    } else {
      await query(
        `UPDATE activities SET duplicate_of = $1 WHERE strava_activity_id = $2`,
        [currentActivityId, candidate.strava_activity_id]
      );
      return null;
    }
  }

  return null;
}

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

async function reprocessFromDate(stravaId, eventId, fromDate) {
  await query(
    `INSERT INTO activity_processing_queue (strava_activity_id, next_run_at)
     SELECT ea.strava_activity_id, NOW()
     FROM event_activities ea
     JOIN activities a ON a.strava_activity_id = ea.strava_activity_id
     WHERE ea.event_id      = $1
       AND a.strava_id      = $2
       AND a.start_date    >= $3
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

    const base = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;

    for (const row of queueResult.rows) {
      const activityId = row.strava_activity_id;

      try {
        // ── Buscar activity no banco ────────────────────────
        const actResult = await query(
          `SELECT strava_activity_id, strava_id, start_date, moving_time,
                  elapsed_time, device_name, gear_id,
                  last_webhook_aspect, last_webhook_updates
           FROM activities
           WHERE strava_activity_id = $1`,
          [activityId]
        );

        if (actResult.rows.length === 0) {
          skipped.push({ activityId, reason: "activity_not_in_db" });
          continue;
        }

        const act      = actResult.rows[0];
        const stravaId = act.strava_id;

        // ── DELETE ──────────────────────────────────────────
        if (act.last_webhook_aspect === "delete") {
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

          await query(`DELETE FROM event_module_processing WHERE strava_activity_id = $1`, [activityId]);
          await query(`DELETE FROM event_activities WHERE strava_activity_id = $1`, [activityId]);
          await query(`DELETE FROM activities WHERE strava_activity_id = $1`, [activityId]);
          await removeFromQueue(activityId);
          processed.push({ activityId, action: "deleted" });
          continue;
        }

        // ── Buscar eventos ativos do atleta ─────────────────
        const eventsResult = await query(
          `SELECT e.id AS event_id
           FROM athlete_events ae
           JOIN events e ON e.id = ae.event_id
           JOIN modules m ON m.id = e.module_id
           WHERE ae.strava_id = $1
             AND ae.status   = 'active'
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

        // ── Zonas de FC da atividade ────────────────────────
        let hrZoneTimes = null;
        try {
          const zonesRes = await fetch(`${STRAVA_API}/activities/${activityId}/zones`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (zonesRes.ok) {
            const zonesData = await zonesRes.json();
            const hrZone = zonesData.find(z => z.type === "heartrate");
            if (hrZone?.distribution_buckets?.length) {
              hrZoneTimes = hrZone.distribution_buckets.map(b => b.time);
            }
          }
        } catch {
          // não bloqueia o fluxo
        }

        // ── Persistir dados completos no banco ─────────────
        await query(
          `UPDATE activities SET
             start_date             = $2,
             start_date_local       = $3,
             distance_m             = $4,
             moving_time            = $5,
             elapsed_time           = $6,
             total_elevation_gain   = $7,
             commute                = $8,
             gear_id                = $9,
             device_name            = $10,
             average_watts          = $11,
             weighted_average_watts = $12,
             device_watts           = $13,
             strava_route_id        = $14,
             average_heartrate      = $15,
             hr_zone_times          = $16,
             updated_at             = NOW()
           WHERE strava_activity_id = $1`,
          [
            activityId,
            stravaActivity.start_date,
            stravaActivity.start_date_local       || null,
            stravaActivity.distance,
            stravaActivity.moving_time,
            stravaActivity.elapsed_time,
            stravaActivity.total_elevation_gain,
            stravaActivity.commute,
            stravaActivity.gear_id                || null,
            stravaActivity.device_name            || null,
            stravaActivity.average_watts          ?? null,
            stravaActivity.weighted_average_watts ?? null,
            stravaActivity.device_watts           ?? null,
            stravaActivity.route_id               || null,
            stravaActivity.average_heartrate      ?? null,
            hrZoneTimes ? JSON.stringify(hrZoneTimes) : null,
          ]
        );

        // ── Upsert gear ─────────────────────────────────────
        if (stravaActivity.gear_id) {
          await upsertGear(stravaActivity.gear_id, stravaId, token);
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

        // ── Upsert event_activities ────────────────────────
        for (const event of eventsResult.rows) {
          await query(
            `INSERT INTO event_activities (event_id, strava_activity_id, processed)
             VALUES ($1, $2, false)
             ON CONFLICT (event_id, strava_activity_id) DO NOTHING`,
            [event.event_id, activityId]
          );
        }

        // ── Reprocessar atividades posteriores ─────────────
        // create → sempre (atividade pode ter chegado fora de ordem)
        // update com type mudado → sempre (altera accepted_sport_types)
        // update de metadados → nunca
        const reprocess = shouldReprocessPosterior(
          act.last_webhook_aspect,
          act.last_webhook_updates
        );

        if (reprocess) {
          for (const event of eventsResult.rows) {
            await query(
              `UPDATE event_activities SET processed = false
               WHERE event_id = $1
                 AND strava_activity_id IN (
                   SELECT a.strava_activity_id
                   FROM activities a
                   WHERE a.strava_id           = $2
                     AND a.strava_activity_id <> $3
                     AND a.start_date          > (SELECT start_date FROM activities WHERE strava_activity_id = $3)
                     AND a.duplicate_of IS NULL
                 )`,
              [event.event_id, stravaId, activityId]
            );

            await query(
              `INSERT INTO activity_processing_queue (strava_activity_id, next_run_at)
               SELECT ea.strava_activity_id, NOW()
               FROM event_activities ea
               JOIN activities a ON a.strava_activity_id = ea.strava_activity_id
               WHERE ea.event_id            = $1
                 AND a.strava_id            = $2
                 AND a.strava_activity_id  <> $3
                 AND a.start_date           > (SELECT start_date FROM activities WHERE strava_activity_id = $3)
                 AND a.duplicate_of IS NULL
               ON CONFLICT (strava_activity_id) DO UPDATE SET next_run_at = NOW()`,
              [event.event_id, stravaId, activityId]
            );
          }
        }

        // ── Chamar dispatcher ───────────────────────────────
        const dispatchRes = await fetch(`${base}/api/internal/module-dispatcher`, {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${process.env.INTERNAL_WORKER_SECRET}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({ strava_activity_id: activityId, strava_id: stravaId }),
        });

        const dispatchData = await dispatchRes.json();

        if (!dispatchRes.ok || !dispatchData.ok) {
          console.error(`[Worker] Dispatcher falhou para ${activityId}:`, dispatchData);
          errors.push({ activityId, reason: "dispatcher_failed", detail: dispatchData });
          continue;
        }

        await removeFromQueue(activityId);
        processed.push({ activityId, action: "processed", dispatcher: dispatchData });

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
