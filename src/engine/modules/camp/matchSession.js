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
 *   2. Data + horário — start_date_local::date = dia da sessão
 *                       + proximidade com scheduled_start
 *   3. Validação cruzada — atividades de outros atletas do grupo
 *                          no mesmo horário reforçam o match
 *
 * Prazo: até 23:59 (horário local) do dia seguinte ao encerramento.
 * Após esse prazo, sessões sem match permanecem sem vínculo —
 * a marcação de not_completed/skipped é responsabilidade de job separado.
 *
 * Chamado pelo dispatcher após computeTotals e antes de buildDescription.
 * Se não encontrar sessão, retorna null sem inserir — buildDescription
 * exibe o bloco sem dayNumber e shortDescription.
 * ============================================================
 */

import { query } from "@/lib/db";

const SCHEDULE_TOLERANCE_MIN = 90; // minutos de tolerância para match por horário

/**
 * Tenta match por strava_route_id.
 *
 * @param {number} eventId
 * @param {number} activityId
 * @returns {object|null} sessão ou null
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
 * Tenta match por data + proximidade de horário com scheduled_start.
 *
 * @param {number} eventId
 * @param {string} activityDate   'YYYY-MM-DD' no horário local
 * @param {string} startDateLocal timestamp local da atividade
 * @returns {object|null} sessão mais próxima dentro da tolerância, ou null
 */
async function matchByDatetime(eventId, activityDate, startDateLocal) {
  const result = await query(
    `SELECT cs.id AS session_id, cs.day_number, cs.session_order,
            cs.short_description,
            ABS(EXTRACT(EPOCH FROM (
              $2::timestamp::time - cs.scheduled_start
            )) / 60) AS diff_min
     FROM camp_sessions cs
     WHERE cs.event_id         = $1
       AND cs.scheduled_start IS NOT NULL
       AND cs.day_number = (
           SELECT day_number
           FROM camp_sessions
           WHERE event_id = $1
             AND scheduled_start IS NOT NULL
           ORDER BY ABS(EXTRACT(EPOCH FROM (
             $2::timestamp::time - scheduled_start
           )))
           LIMIT 1
       )
       AND ABS(EXTRACT(EPOCH FROM (
         $2::timestamp::time - cs.scheduled_start
       )) / 60) <= $3
     ORDER BY diff_min ASC
     LIMIT 1`,
    [eventId, startDateLocal, SCHEDULE_TOLERANCE_MIN]
  );

  return result.rows[0] || null;
}

/**
 * Validação cruzada: verifica se outros atletas do mesmo evento
 * têm atividades vinculadas à sessão candidata em horário próximo.
 * Reforça o match quando o critério principal tem baixa confiança.
 *
 * @param {number} sessionId
 * @param {string} startDateLocal
 * @returns {boolean} true se há evidência de outros atletas
 */
async function crossValidate(sessionId, startDateLocal) {
  const result = await query(
    `SELECT COUNT(DISTINCT csa.strava_id) AS peer_count
     FROM camp_session_activities csa
     WHERE csa.session_id = $1
       AND ABS(EXTRACT(EPOCH FROM (
         csa.start_date_local - $2::timestamp
       )) / 60) <= $3`,
    [sessionId, startDateLocal, SCHEDULE_TOLERANCE_MIN]
  );

  return parseInt(result.rows[0]?.peer_count || 0) > 0;
}

/**
 * Executa o match e registra em camp_session_activities.
 *
 * @param {object} context
 * @param {number} context.activityId
 * @param {number} context.stravaId
 * @param {number} context.eventId
 * @param {string} context.startDateLocal  timestamp local da atividade
 * @returns {object|null} { sessionId, dayNumber, sessionOrder, shortDescription, matchMethod }
 *                        null se nenhuma sessão compatível encontrada
 */
export async function matchSession({ activityId, stravaId, eventId, startDateLocal }) {
  if (!startDateLocal) return null;

  const activityDate = startDateLocal.slice(0, 10);

  // ── 1. Match por rota ───────────────────────────────────
  let session     = await matchByRoute(eventId, activityId);
  let matchMethod = 'route';

  // ── 2. Match por data + horário ─────────────────────────
  if (!session) {
    session     = await matchByDatetime(eventId, activityDate, startDateLocal);
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
