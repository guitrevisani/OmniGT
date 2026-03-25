/**
 * ============================================================
 * src/engine/modules/camp/matchSession.js
 * ============================================================
 *
 * Determina a qual sessão pré-definida do camp pertence uma
 * atividade e registra o vínculo em camp_session_activities.
 *
 * Critérios de match em ordem de prioridade:
 *   1. strava_route_id — comparado com activity.route_id do Strava
 *   2. scheduled_date + scheduled_start — data exata da sessão
 *      + proximidade com o horário da atividade
 *   3. Validação cruzada — atividades de outros atletas do grupo
 *      no mesmo horário reforçam o match
 *
 * Prazo: até 23:59 (horário local) do dia seguinte ao encerramento.
 * Após esse prazo, sessões sem match permanecem sem vínculo —
 * a marcação de not_completed/skipped é responsabilidade de job separado.
 * ============================================================
 */

import { query } from "@/lib/db";

const SCHEDULE_TOLERANCE_EARLY_MIN = 30; // atividade pode começar até 30min antes
const SCHEDULE_TOLERANCE_LATE_MIN  = 90; // atividade pode começar até 90min depois

/**
 * Tenta match por strava_route_id.
 */
async function matchByRoute(eventId, activityId) {
  const result = await query(
    `SELECT cs.id AS session_id, cs.day_number, cs.session_order, cs.short_description
     FROM camp_sessions cs
     JOIN activities a ON a.strava_route_id = cs.strava_route_id
     WHERE cs.event_id          = $1
       AND cs.strava_route_id IS NOT NULL
       AND a.strava_activity_id = $2`,
    [eventId, activityId]
  );

  return result.rows[0] || null;
}

/**
 * Tenta match por data exata (scheduled_date) + proximidade de horário.
 *
 * scheduled_date é comparado com a data local da atividade.
 * scheduled_start é comparado com o horário local da atividade,
 * dentro da tolerância de SCHEDULE_TOLERANCE_MIN minutos.
 *
 * @param {number} eventId
 * @param {string} startDateLocal  'YYYY-MM-DD HH24:MI:SS' — já formatado pelo banco
 * @returns {object|null}
 */
async function matchByDatetime(eventId, startDateLocal) {
  const result = await query(
    `SELECT cs.id AS session_id, cs.day_number, cs.session_order,
            cs.short_description,
            EXTRACT(EPOCH FROM (
              $2::timestamp::time - cs.scheduled_start
            )) / 60 AS diff_min
     FROM camp_sessions cs
     WHERE cs.event_id         = $1
       AND cs.scheduled_date   = $2::timestamp::date
       AND cs.scheduled_start IS NOT NULL
       AND $2::timestamp::time >= cs.scheduled_start - ($3 * INTERVAL '1 minute')
       AND $2::timestamp::time <= cs.scheduled_start + ($4 * INTERVAL '1 minute')
     ORDER BY ABS(EXTRACT(EPOCH FROM ($2::timestamp::time - cs.scheduled_start))) ASC
     LIMIT 1`,
    [eventId, startDateLocal, SCHEDULE_TOLERANCE_EARLY_MIN, SCHEDULE_TOLERANCE_LATE_MIN]
  );

  return result.rows[0] || null;
}

/**
 * Validação cruzada: verifica se outros atletas do mesmo evento
 * têm atividades vinculadas à sessão candidata em horário próximo.
 */
async function crossValidate(sessionId, startDateLocal) {
  const result = await query(
    `SELECT COUNT(DISTINCT csa.strava_id) AS peer_count
     FROM camp_session_activities csa
     WHERE csa.session_id = $1
       AND ABS(EXTRACT(EPOCH FROM (
         csa.start_date_local - $2::timestamp
       )) / 60) <= $3`,
    [sessionId, startDateLocal, SCHEDULE_TOLERANCE_LATE_MIN]
  );

  return parseInt(result.rows[0]?.peer_count || 0) > 0;
}

/**
 * Executa o match e registra em camp_session_activities.
 *
 * @returns {object|null} { sessionId, dayNumber, sessionOrder, shortDescription, matchMethod }
 *                        null se nenhuma sessão compatível encontrada
 */
export async function matchSession({ activityId, stravaId, eventId, startDateLocal }) {
  if (!startDateLocal) return null;

  // ── 1. Match por rota ───────────────────────────────────
  let session     = await matchByRoute(eventId, activityId);
  let matchMethod = 'route';

  // ── 2. Match por data + horário ─────────────────────────
  if (!session) {
    session     = await matchByDatetime(eventId, startDateLocal);
    matchMethod = 'datetime';
  }

  if (!session) return null;

  // ── 3. Validação cruzada (reforço — não bloqueia o match) ──
  const hasPeers = await crossValidate(session.session_id, startDateLocal);
  if (hasPeers && matchMethod === 'datetime') {
    matchMethod = 'crossvalidation';
  }

  // ── Registrar vínculo ───────────────────────────────────
  await query(
    `INSERT INTO camp_session_activities
       (session_id, strava_activity_id, strava_id, match_method, start_date_local)
     VALUES ($1, $2, $3, $4, $5::timestamp)
     ON CONFLICT (strava_activity_id) DO UPDATE SET
       session_id         = EXCLUDED.session_id,
       strava_id          = EXCLUDED.strava_id,
       match_method       = EXCLUDED.match_method,
       start_date_local   = EXCLUDED.start_date_local,
       matched_at         = now()`,
    [session.session_id, activityId, stravaId, matchMethod, startDateLocal]
  );

  return {
    sessionId:        session.session_id,
    dayNumber:        session.day_number,
    sessionOrder:     session.session_order,
    shortDescription: session.short_description,
    matchMethod,
  };
}
