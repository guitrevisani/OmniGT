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

/**
 * Atualiza hr_min em athletes se o mínimo do stream for menor
 * que o valor atualmente persistido.
 * Usa o stream quando disponível — average_heartrate é média, não mínima.
 */
async function updateHrMin(stravaId, hrStream) {
  if (!hrStream?.length) return;

  const hrMinActivity = Math.min(...hrS
