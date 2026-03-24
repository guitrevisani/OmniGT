/**
 * ============================================================
 * src/engine/modules/camp/index.js
 * ============================================================
 *
 * Hierarquia de cálculo:
 *
 * TSS:
 *   1. TRIMP por stream (hr_stream + hr_zones + hr_min)
 *   2. TRIMP por FC média (average_heartrate + hr_max + hr_min)
 *   3. TRIMP com defaults (average_heartrate + hr_max)
 *   4. TSS padrão (weighted_average_watts + ftp_w) — sem FC
 *   5. Cinemático — sem FC, sem sensor
 *
 * NP:
 *   1. Sensor (weighted_average_watts)
 *   2. Derivado do IF: NP = IF × ftp
 *
 * IF:
 *   1. Média(IF_sensor, IF_trimp) — com sensor + ftp_w + FC
 *   2. IF_sensor = NP_sensor / ftp_w — com sensor + ftp_w, sem FC
 *   3. Derivado do TSS — demais casos
 * ============================================================
 */

import { computeTotals }    from "./computeTotals.js";
import { matchSession }     from "./matchSession.js";
import { buildDescription } from "./buildDescription.js";
import { estimateLoad }     from "@/lib/physics/estimateLoad.js";
import { estimatePower }    from "@/lib/physics/estimatePower.js";
import { estimateFTP }      from "@/lib/physics/estimateFTP.js";
import { calculateTSS }     from "@/lib/physics/calculateTSS.js";
import { query }            from "@/lib/db";

export const REPROCESS_ON_DELETE = true;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAthleteProfile(stravaId) {
  const result = await query(
    `SELECT ftp_w, weight_kg, hr_max, hr_min, hr_limiar, hr_zones, gender, birth_date
     FROM athletes
     WHERE strava_id = $1`,
    [stravaId]
  );
  return result.rows[0] || {};
}

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

  const sessionMatch = await matchSession({ activityId, stravaId, eventId, startDateLocal });

  // Atividade fora das sessões configuradas — não processa
  if (!sessionMatch) return null;

  const totals  = await computeTotals(context);
  const profile = await getAthleteProfile(stravaId);
  const age     = calcAge(profile.birth_date);

  const { powerZones, hrZones: stravaHrZones } = await getStravaZones(stravaId);

  // hr_zones: perfil do atleta tem prioridade sobre Strava
  const hrZones = profile.hr_zones || stravaHrZones || null;

  // ── FTP ───────────────────────────────────────────────────
  const { ftp, method: ftpMethod } = estimateFTP({
    ftpW:       profile.ftp_w    || null,
    powerZones: powerZones       || null,
    hrZones:    hrZones,
    gender:     profile.gender   || 'masculino',
    weightKg:   profile.weight_kg || null,
  });

  // ── TSS ───────────────────────────────────────────────────
  let tss, ifValue, np, npMethod, ftpEstimated, loadMethod;

  const hasSensor = totals.weightedAvgWatts != null;
  const hasFC     = !!(totals.hrStream?.length || totals.averageHeartrate);

  if (hasFC) {
    // TRIMP — fonte primária quando FC disponível
    const load = estimateLoad({
      hrStream:          totals.hrStream,
      averageHeartrate:  totals.averageHeartrate,
      hrMin:             profile.hr_min    || null,
      hrMax:             profile.hr_max    || null,
      hrLimiar:          profile.hr_limiar || null,
      hrZones,
      age,
      gender:            profile.gender || 'masculino',
      movingTimeSec:     totals.activityMovingTimeSec,
    });

    if (load) {
      tss        = load.tss;
      loadMethod = load.method;

      if (hasSensor && ftp > 0) {
        // IF = média(IF_sensor, IF_trimp)
        const ifSensor = totals.weightedAvgWatts / ftp;
        ifValue        = Math.round(((ifSensor + load.ifValue) / 2) * 100) / 100;
        np             = totals.weightedAvgWatts;
        npMethod       = 'sensor';
      } else {
        ifValue  = load.ifValue;
        // NP derivado do IF
        const derived = estimatePower({
          ifValue,
          ftp,
          distanceM:        totals.activityDistanceM,
          movingTimeSec:    totals.activityMovingTimeSec,
          elevationGainM:   totals.activityElevationM,
          params:           profile.weight_kg ? { mass_kg: profile.weight_kg + 10 } : {},
        });
        np       = derived.np;
        npMethod = derived.method;
      }
      ftpEstimated = ftpMethod !== 'informed';
    }
  }

  // Fallback: sem FC ou estimateLoad falhou
  if (tss == null) {
    if (hasSensor && ftp > 0) {
      // TSS padrão por potência
      np       = totals.weightedAvgWatts;
      npMethod = 'sensor';
      ifValue  = Math.round((np / ftp) * 100) / 100;
      tss      = Math.round(
        (totals.activityMovingTimeSec * np * ifValue) / (ftp * 3600) * 100
      );
      ftpEstimated = ftpMethod !== 'informed';
      loadMethod   = 'power';
    } else {
      // Cinemático
      const derived = estimatePower({
        ifValue:       null,
        ftp,
        distanceM:     totals.activityDistanceM,
        movingTimeSec: totals.activityMovingTimeSec,
        elevationGainM: totals.activityElevationM,
        params:        profile.weight_kg ? { mass_kg: profile.weight_kg + 10 } : {},
      });
      np       = derived.np;
      npMethod = derived.method;
      ifValue  = ftp > 0 ? Math.round((np / ftp) * 100) / 100 : 0;
      tss      = Math.round(
        (totals.activityMovingTimeSec * np * ifValue) / (ftp * 3600) * 100
      );
      ftpEstimated = ftpMethod !== 'informed';
      loadMethod   = 'kinematic';
    }
  }

  const npEstimated = npMethod !== 'sensor';

  // ── Persistir TSS e ler campTss ───────────────────────────
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

  return {
    totals,
    np,
    npEstimated,
    npMethod,
    ifValue,
    ftpEstimated,
    tss,
    campTss,
    loadMethod,
  };
}

export { buildDescription };
