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
 *     - estimatePower / estimateFTP / calculateIF / calculateTSS
 *     - persiste TSS em camp_session_activities
 *     - lê campTss APÓS persistência (evita race condition)
 *
 * Perfil do atleta lido de athletes (dados pessoais migrados
 * de camp_athlete_profiles em 2026-03-19).
 * ============================================================
 */

import { computeTotals }    from "./computeTotals.js";
import { matchSession }     from "./matchSession.js";
import { buildDescription } from "./buildDescription.js";
import { estimatePower }    from "@/lib/physics/estimatePower.js";
import { estimateFTP }      from "@/lib/physics/estimateFTP.js";
import { calculateIF }      from "@/lib/physics/estimateIF.js";
import { calculateTSS }     from "@/lib/physics/calculateTSS.js";
import { query }            from "@/lib/db";

export const REPROCESS_ON_DELETE = true;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAthleteProfile(stravaId) {
  const result = await query(
    `SELECT ftp_w, weight_kg, hr_max, hr_zones, gender, birth_date
     FROM athletes
     WHERE strava_id = $1`,
    [stravaId]
  );
  return result.rows[0] || {};
}

/**
 * Busca zonas de potência e FC do atleta no Strava em um único call.
 * Retorna { powerZones, hrZones } — ambos null se indisponível.
 */
async function getStravaZones(stravaId) {
  try {
    const tokenResult = await query(
      `SELECT access_token, expires_at FROM athletes WHERE strava_id = $1`,
      [stravaId]
    );
    if (!tokenResult.rows.length) return { powerZones: null, hrZones: null };

    const { access_token, expires_at } = tokenResult.rows[0];
    if (Math.floor(Date.now() / 1000) > expires_at) return { powerZones: null, hrZones: null };

    const res = await fetch('https://www.strava.com/api/v3/athlete/zones', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) return { powerZones: null, hrZones: null };

    const data = await res.json();
    return {
      powerZones: data?.power?.zones      || null,
      hrZones:    data?.heart_rate?.zones || null,
    };
  } catch {
    return { powerZones: null, hrZones: null };
  }
}

/**
 * Calcula idade a partir de birth_date.
 * Retorna null se birth_date não disponível.
 */
function calcAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age--;
  return age;
}

/**
 * Lê o TSS acumulado do camp para o atleta até a atividade atual (inclusive).
 * Chamado APÓS o TSS da atividade atual ser persistido.
 */
async function readCampTss(stravaId, eventId, activityId) {
  const result = await query(
    `SELECT COALESCE(SUM(csa.tss), 0) AS camp_tss
     FROM camp_session_activities csa
     JOIN camp_sessions cs ON cs.id = csa.session_id
     JOIN activities a ON a.strava_activity_id = csa.strava_activity_id
     WHERE cs.event_id   = $1
       AND csa.strava_id = $2
       AND a.start_date <= (SELECT start_date FROM activities WHERE strava_activity_id = $3)`,
    [eventId, stravaId, activityId]
  );
  return parseFloat(result.rows[0]?.camp_tss || 0);
}

// ─── consolidate ──────────────────────────────────────────────────────────────

export async function consolidate(context) {
  const { stravaId, activityId, eventId, startDateLocal } = context;

  // ── Match de sessão ───────────────────────────────────────
  await matchSession({ activityId, stravaId, eventId, startDateLocal });

  // ── Totais + sessão vinculada ─────────────────────────────
  const totals = await computeTotals(context);

  // ── Perfil do atleta ──────────────────────────────────────
  const profile = await getAthleteProfile(stravaId);
  const age     = calcAge(profile.birth_date);

  // ── Zonas do Strava (potência + FC) — um único call ───────
  const { powerZones, hrZones } = await getStravaZones(stravaId);

  // ── FTP ───────────────────────────────────────────────────
  const { ftp, method: ftpMethod } = estimateFTP({
    ftpW:       profile.ftp_w    || null,
    powerZones: powerZones       || null,
    hrZones:    profile.hr_zones || hrZones || null,
    gender:     profile.gender   || 'masculino',
    weightKg:   profile.weight_kg || null,
  });

  // ── NP: sensor > FC > cinemático ─────────────────────────
  let np, npMethod;

  if (totals.weightedAvgWatts != null) {
    np       = totals.weightedAvgWatts;
    npMethod = 'sensor';
  } else {
    const estimated = estimatePower({
      averageHeartrate: totals.averageHeartrate,
      hrMax:            profile.hr_max,
      age,
      ftp,
      distanceM:        totals.activityDistanceM,
      movingTimeSec:    totals.activityMovingTimeSec,
      elevationGainM:   totals.activityElevationM,
      params:           profile.weight_kg ? { mass_kg: profile.weight_kg + 10 } : {},
    });
    np       = estimated.np;
    npMethod = estimated.method;
  }

  const npEstimated = npMethod !== 'sensor';

  // ── IF ────────────────────────────────────────────────────
  const { if: ifValue, ftpEstimated } = calculateIF({
    np,
    ftp,
    npEstimated,
    ftpMethod,
  });

  // ── TSS ───────────────────────────────────────────────────
  const tss = calculateTSS({
    movingTimeSec: totals.activityMovingTimeSec,
    np,
    ifValue,
    ftp,
  });

  // ── Persistir TSS e ler campTss (nesta ordem) ─────────────
  let campTss = 0;

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

      campTss = await readCampTss(stravaId, eventId, activityId);
    }
  }

  return { totals, np, npEstimated, npMethod, ifValue, ftpEstimated, tss, campTss };
}

export { buildDescription };
