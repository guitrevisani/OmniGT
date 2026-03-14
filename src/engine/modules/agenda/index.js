/**
 * ============================================================
 * AGENDA MODULE — index.js
 * ============================================================
 *
 * Módulo de consolidação de atividades de ciclismo.
 *
 * Tipos de atividade aceitos:
 *   Ride, VirtualRide, HandCycle, Velomobile
 *
 * Contrato de entrada (context):
 * {
 *   db:    { query: Function }   pool do Neon/Postgres via lib/db
 *   event: { id, name, start_date, end_date }
 *   athlete: { strava_id }
 *   isRegistration: boolean      se true, omite buildDescription
 * }
 *
 * Contrato de saída:
 * {
 *   module:           "agenda"
 *   descriptionBlock: string     bloco para o aggregator
 *   dashboard:        object
 *   totals:           object
 *   ranking:          null
 * }
 * ============================================================
 */

import { runModule }       from "../../moduleRunner.js";
import { buildDescription } from "./buildDescription.js";
import { computeDashboard } from "./computeDashboard.js";
import { computeTotals }    from "./computeTotals.js";

/**
 * Tipos de atividade de ciclismo aceitos pelo módulo.
 * Usado pelo worker para filtrar antes de chamar o módulo.
 */
export const ACCEPTED_SPORT_TYPES = [
  "Ride",
  "VirtualRide",
  "HandCycle",
  "Velomobile",
];

export const REPROCESS_ON_DELETE = true;

/**
 * Consolidação dos dados do período do evento para o atleta.
 * Busca agenda_daily + agenda_goals em uma única query com LEFT JOIN.
 */
export async function consolidate(context) {
  const result = await context.db.query(
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
       ON g.event_id = d.event_id
      AND g.strava_id = d.strava_id
     WHERE d.event_id = $1
       AND d.strava_id = $2
       AND d.activity_date >= $3
       AND d.activity_date <= $4
     ORDER BY d.activity_date`,
    [
      context.event.id,
      context.athlete.strava_id,
      context.event.start_date,
      context.event.end_date,
    ]
  );

  return { daily: result.rows };
}

/**
 * Ponto de entrada do módulo.
 * Chamado pelo moduleRunner para cada evento/atleta.
 */
export async function run(context) {
  const builders = {
    computeDashboard,
    computeTotals,
    // buildDescription é omitido em contexto de inscrição
    ...(context.isRegistration ? {} : { buildDescription }),
  };

  return runModule({
    moduleName: "agenda",
    context,
    consolidate,
    builders,
  });
}
