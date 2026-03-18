/**
 * ============================================================
 * src/engine/modules/camp/index.js
 * ============================================================
 *
 * Ponto de entrada do módulo Camp.
 *
 * Expõe:
 *   REPROCESS_ON_DELETE — true: ao deletar uma atividade,
 *     reprocessa todas as posteriores do atleta no evento.
 *
 *   consolidate(context) — busca dados necessários para o bloco:
 *     - matchSession: vincula atividade à sessão se ainda não vinculada
 *     - computeTotals: acumulados + métricas da atividade + sessão
 *     - estimateNP / estimateFTP / calculateIF: métricas de potência
 *
 * accepted_sport_types não é definido aqui — vem de
 * event_configs.metadata.accepted_sport_types (ADR-010).
 *
 * REPROCESS_ON_DELETE = true pois os acumulados do camp são
 * retroativamente ignorantes — deletar uma atividade altera
 * os consolidados de todas as posteriores.
 * ============================================================
 */

import { computeTotals }    from "./computeTotals.js";
import { matchSession }     from "./matchSession.js";
import { buildDescription } from "./buildDescription.js";
import { estimateNP }       from "@/lib/physics/estimateNP.js";
import { estimateFTP }      from "@/lib/physics/estimateFTP.js";
import { calculateIF }      from "@/lib/physics/estimateIF.js";
import { query }            from "@/lib/db";

export const REPROCESS_ON_DELETE = true;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Busca o perfil do atleta no camp (formulário de inscrição).
 * Retorna objeto vazio se não encontrado.
 */
async function getAthleteProfile(stravaId, eventId) {
  const result = await query(
    `SELECT ftp_w, weight_kg, hr_max, hr_zones, gender
     FROM camp_athlete_profiles
     WHERE strava_id = $1 AND event_id = $2`,
    [stravaId, eventId]
  );
  return result.rows[0] || {};
}

/**
 * Busca as zonas de potência do atleta no Strava.
 * Retorna null silenciosamente em caso de token expirado ou erro.
 * Não faz refresh — o token já foi renovado pelo worker antes de chegar aqui.
 */
async function getStravaPowerZones(stravaId) {
  try {
    const tokenResult = await query(
      `SELECT access_token, expires_at FROM athletes WHERE strava_id = $1`,
      [stravaId]
    );
    if (!tokenResult.rows.length) return null;

    const { access_token, expires_at } = tokenResult.rows[0];
    if (Math.floor(Date.now() / 1000) > expires_at) return null;

    const res = await fetch('https://www.strava.com/api/v3/athlete/zones', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    return data?.power?.zones || null;
  } catch {
    return null;
  }
}

// ─── consolidate ──────────────────────────────────────────────────────────────

/**
 * Consolida todos os dados necessários para o bloco de descrição.
 *
 * Contrato de entrada (context):
 * {
 *   stravaId:       bigint
 *   activityId:     bigint
 *   eventId:        int
 *   eventName:      string
 *   eventStartDate: string 'YYYY-MM-DD'
 *   startDateLocal: string timestamp local da atividade
 * }
 *
 * Contrato de saída:
 * {
 *   totals:       objeto de computeTotals
 *   np:           number   watts
 *   npEstimated:  boolean
 *   ifValue:      number
 *   ftpEstimated: boolean
 *   tss:          number
 *   campTss:      number
 * }
 */
export async function consolidate(context) {
  const { stravaId, activityId, eventId, startDateLocal } = context;

  // ── Match de sessão (se ainda não vinculada) ──────────────
  await matchSession({ activityId, stravaId, eventId, startDateLocal });

  // ── Totais + sessão vinculada ─────────────────────────────
  const totals = await computeTotals(context);

  // ── Perfil do atleta ──────────────────────────────────────
  const profile = await getAthleteProfile(stravaId, eventId);

  // ── NP: medida ou estimada ────────────────────────────────
  let np, npEstimated;

  if (totals.weightedAvgWatts != null) {
    np          = totals.weightedAvgWatts;
    npEstimated = false;
  } else {
    np          = estimateNP({
      distanceM:      totals.activityDistanceM,
      movingTimeSec:  totals.activityMovingTimeSec,
      elevationGainM: totals.activityElevationM,
      params: profile.weight_kg ? { mass_kg: profile.weight_kg } : {},
    });
    npEstimated = true;
  }

  // ── FTP: informado, por zonas de potência ou estimado ─────
  const powerZones = await getStravaPowerZones(stravaId);

  const { ftp, method: ftpMethod } = estimateFTP({
    ftpW:       profile.ftp_w    || null,
    powerZones: powerZones       || null,
    hrZones:    profile.hr_zones || null,
    gender:     profile.gender   || 'masculino',
    weightKg:   profile.weight_kg || null,
  });

  // ── IF ────────────────────────────────────────────────────
  const { if: ifValue, ftpEstimated } = calculateIF({
    np,
    ftp,
    npEstimated,
    ftpMethod,
  });

  // ── TSS ──────────────────────────────────────────────────
  const tss = calculateTSS({
    movingTimeSec: totals.activityMovingTimeSec,
    np,
    ifValue,
    ftp,
  });

  // Persistir TSS em camp_session_activities se sessão vinculada
  if (totals.dayNumber != null) {
    const sessionResult = await query(
      `SELECT csa.id FROM camp_session_activities csa
       JOIN camp_sessions cs ON cs.id = csa.session_id
       WHERE csa.strava_activity_id = $1 AND cs.event_id = $2`,
      [activityId, eventId]
    );
    if (sessionResult.rows.length > 0) {
      await query(
        `UPDATE camp_session_activities SET tss = $1
         WHERE strava_activity_id = $2`,
        [tss, activityId]
      );
    }
  }

  return { totals, np, npEstimated, ifValue, ftpEstimated, tss, campTss: totals.campTss };
}

export { buildDescription };
