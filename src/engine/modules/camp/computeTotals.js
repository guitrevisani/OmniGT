/**
 * ============================================================
 * CAMP MODULE — computeTotals
 * ============================================================
 *
 * Consolida métricas da atividade atual e acumulados do camp
 * até e incluindo a atividade X (retroativamente ignorante).
 *
 * Contrato de entrada (context):
 * {
 *   stravaId:       bigint
 *   activityId:     bigint
 *   eventId:        int
 *   eventStartDate: string 'YYYY-MM-DD'
 * }
 *
 * Contrato de saída:
 * {
 *   activityDistanceM:     number
 *   activityElevationM:    number
 *   activityMovingTimeSec: number
 *   weightedAvgWatts:      number | null
 *   deviceWatts:           boolean
 *   averageHeartrate:      number | null
 *   hrZoneTimes:           number[] | null
 *   hrStream:              number[] | null
 *
 *   campDistanceM:         number
 *   campElevationM:        number
 *   campMovingTimeSec:     number
 *
 *   dayNumber:             int | null
 *   sessionOrder:          int | null
 *   shortDescription:      string | null
 * }
 *
 * Nota: campTss não é retornado aqui — calculado em index.js
 * após persistência do TSS da atividade atual.
 * ============================================================
 */

import { query } from "@/lib/db";

export async function computeTotals(context) {
  const { stravaId, activityId, eventId } = context;

  // ── Métricas da atividade atual ───────────────────────────
  const activityResult = await query(
    `SELECT
       distance_m,
       total_elevation_gain,
       moving_time,
       weighted_average_watts,
       device_watts,
       average_heartrate,
       hr_zone_times,
       hr_stream
     FROM activities
     WHERE strava_activity_id = $1`,
    [activityId]
  );

  if (activityResult.rows.length === 0) {
    throw new Error(`Activity ${activityId} not found`);
  }

  const act = activityResult.rows[0];

  // ── Acumulados do camp até esta atividade (inclusive) ─────
  // Apenas atividades com match em camp_session_activities —
  // atividades fora das sessões configuradas não entram no acumulado.
  const campResult = await query(
    `SELECT
       COALESCE(SUM(a.distance_m), 0)          AS camp_distance_m,
       COALESCE(SUM(a.total_elevation_gain), 0) AS camp_elevation_m,
       COALESCE(SUM(a.moving_time), 0)          AS camp_moving_time_sec
     FROM activities a
     JOIN camp_session_activities csa ON csa.strava_activity_id = a.strava_activity_id
     JOIN camp_sessions cs            ON cs.id = csa.session_id
     WHERE cs.event_id      = $2
       AND csa.strava_id    = $1
       AND a.duplicate_of IS NULL
       AND a.start_date    <= (SELECT start_date FROM activities WHERE strava_activity_id = $3)`,
    [stravaId, eventId, activityId]
  );

  const camp = campResult.rows[0];

  // ── Sessão vinculada ──────────────────────────────────────
  const sessionResult = await query(
    `SELECT
       cs.day_number,
       cs.session_order,
       cs.short_description
     FROM camp_session_activities csa
     JOIN camp_sessions cs ON cs.id = csa.session_id
     WHERE csa.strava_activity_id = $1
       AND cs.event_id            = $2`,
    [activityId, eventId]
  );

  const session = sessionResult.rows[0] || null;

  return {
    activityDistanceM:     parseFloat(act.distance_m)          || 0,
    activityElevationM:    parseFloat(act.total_elevation_gain) || 0,
    activityMovingTimeSec: parseInt(act.moving_time)            || 0,
    weightedAvgWatts:      act.weighted_average_watts != null
                             ? parseFloat(act.weighted_average_watts)
                             : null,
    deviceWatts:           act.device_watts === true,
    averageHeartrate:      act.average_heartrate != null
                             ? parseFloat(act.average_heartrate)
                             : null,
    hrZoneTimes:           act.hr_zone_times ?? null,
    hrStream:              act.hr_stream     ?? null,

    campDistanceM:         parseFloat(camp.camp_distance_m)      || 0,
    campElevationM:        parseFloat(camp.camp_elevation_m)     || 0,
    campMovingTimeSec:     parseFloat(camp.camp_moving_time_sec) || 0,

    dayNumber:        session?.day_number        ?? null,
    sessionOrder:     session?.session_order     ?? null,
    shortDescription: session?.short_description ?? null,
  };
}
