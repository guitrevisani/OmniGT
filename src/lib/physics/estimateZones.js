/**
 * ============================================================
 * src/lib/physics/estimateZones.js
 * ============================================================
 *
 * Constrói zonas de FC no modelo da plataforma (5 zonas).
 * Z5 não é desmembrada — FC demora para estabilizar em esforços
 * máximos, tornando o desmembramento impreciso na prática.
 * O desmembramento Z5a/Z5b/Z5c aplica-se apenas a zonas de potência.
 *
 * Modelo de zonas da plataforma (% FCmáx):
 *   Z1: 40% – 54%
 *   Z2: 55% – 67%
 *   Z3: 68% – 76%
 *   Z4: 77% – 85%
 *   Z5: 86% – 100% (sem limite superior definido além da FCmáx)
 *
 * Fonte das zonas (ordem de preferência):
 *   1. hr_zones do perfil do atleta [z1_max, z2_max, z3_max, z4_max, hr_max]
 *      Limites exatos informados pelo atleta — máxima precisão
 *   2. hr_max do perfil + percentuais hardcoded da plataforma
 *      Construção automática quando o atleta informa apenas FCmáx
 *   3. Zonas de FC do Strava (GET /athlete/zones) — 5 zonas { min, max }
 *   4. null — dados insuficientes
 *
 * ============================================================
 */

// Percentuais de início de cada zona (% FCmáx) — modelo da plataforma
const ZONE_PCT = [0.40, 0.55, 0.68, 0.77, 0.86];

/**
 * Constrói zonas a partir dos limites exatos do perfil do atleta.
 * hrZones: [z1_max, z2_max, z3_max, z4_max, hr_max]
 *
 * @param {number[]} hrZones
 * @returns {object|null}
 */
function zonesFromProfile(hrZones) {
  if (!Array.isArray(hrZones) || hrZones.length < 5) return null;

  const [z1Max, z2Max, z3Max, z4Max, hrMax] = hrZones.map(Number);
  if (!hrMax || hrMax <= 0) return null;

  return {
    z1: { min: Math.round(hrMax * ZONE_PCT[0]), max: z1Max },
    z2: { min: z1Max + 1,                       max: z2Max },
    z3: { min: z2Max + 1,                       max: z3Max },
    z4: { min: z3Max + 1,                       max: z4Max },
    z5: { min: z4Max + 1,                       max: null  },
    hrMax,
    source: 'profile',
  };
}

/**
 * Constrói zonas a partir da FCmáx usando percentuais da plataforma.
 *
 * @param {number} hrMax
 * @returns {object|null}
 */
function zonesFromHrMax(hrMax) {
  if (!hrMax || hrMax <= 0) return null;

  const [z1Min, z2Min, z3Min, z4Min, z5Min] = ZONE_PCT.map(p => Math.round(hrMax * p));

  return {
    z1: { min: z1Min,     max: z2Min - 1 },
    z2: { min: z2Min,     max: z3Min - 1 },
    z3: { min: z3Min,     max: z4Min - 1 },
    z4: { min: z4Min,     max: z5Min - 1 },
    z5: { min: z5Min,     max: null       },
    hrMax,
    source: 'hr_max',
  };
}

/**
 * Constrói zonas a partir das zonas de FC do Strava.
 * stravaZones: array de 5 objetos { min, max } (max = -1 na última zona)
 *
 * @param {Array} stravaZones
 * @returns {object|null}
 */
function zonesFromStrava(stravaZones) {
  if (!Array.isArray(stravaZones) || stravaZones.length < 5) return null;

  const z = stravaZones.map(zone => ({
    min: zone.min ?? 0,
    max: zone.max === -1 ? null : zone.max,
  }));

  return {
    z1: z[0],
    z2: z[1],
    z3: z[2],
    z4: z[3],
    z5: z[4],
    hrMax: z[3].max ?? null,
    source: 'strava',
  };
}

/**
 * Resolve as zonas de FC seguindo a ordem de preferência.
 *
 * @param {object} options
 * @param {number[]|null} options.hrZones     [z1_max, z2_max, z3_max, z4_max, hr_max]
 * @param {number|null}   options.hrMax       FCmáx isolada (sem zonas completas)
 * @param {Array|null}    options.stravaZones Zonas do Strava (GET /athlete/zones)
 * @returns {object|null}
 */
export function buildZones({ hrZones, hrMax, stravaZones }) {
  return zonesFromProfile(hrZones)
      ?? zonesFromHrMax(hrMax)
      ?? zonesFromStrava(stravaZones)
      ?? null;
}

/**
 * Determina em qual zona de FC um valor de bpm se enquadra.
 *
 * @param {number} bpm
 * @param {object} zones  retorno de buildZones()
 * @returns {string|null} 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | null
 */
export function classifyHR(bpm, zones) {
  if (!zones || !bpm) return null;

  for (const key of ['z1', 'z2', 'z3', 'z4', 'z5']) {
    const zone = zones[key];
    if (!zone) continue;
    const aboveMin = bpm >= zone.min;
    const belowMax = zone.max === null || bpm <= zone.max;
    if (aboveMin && belowMax) return key;
  }

  return null;
}

// ─── Zonas de Potência ────────────────────────────────────────────────────────

/**
 * Percentuais de início de cada zona de potência (% FTP) — modelo da plataforma.
 * Versão adaptada de Coggan com 7 zonas (Z1–Z5c).
 */
const POWER_ZONE_PCT = [0.45, 0.56, 0.76, 0.91, 1.06, 1.21, 1.51];

/**
 * Constrói zonas de potência a partir do FTP.
 *
 * @param {number} ftp  FTP em watts (informado ou estimado)
 * @returns {object}
 */
export function buildPowerZones(ftp) {
  if (!ftp || ftp <= 0) throw new Error('FTP inválido para construção de zonas de potência');

  const [z1Min, z2Min, z3Min, z4Min, z5aMin, z5bMin, z5cMin] =
    POWER_ZONE_PCT.map(p => Math.round(ftp * p));

  return {
    z1:  { min: z1Min,  max: z2Min  - 1 },
    z2:  { min: z2Min,  max: z3Min  - 1 },
    z3:  { min: z3Min,  max: z4Min  - 1 },
    z4:  { min: z4Min,  max: z5aMin - 1 },
    z5a: { min: z5aMin, max: z5bMin - 1 },
    z5b: { min: z5bMin, max: z5cMin - 1 },
    z5c: { min: z5cMin, max: null       },
    ftp,
  };
}

/**
 * Determina em qual zona de potência um valor em watts se enquadra.
 *
 * @param {number} watts
 * @param {object} zones  retorno de buildPowerZones()
 * @returns {string|null} 'z1' | 'z2' | 'z3' | 'z4' | 'z5a' | 'z5b' | 'z5c' | null
 */
export function classifyPower(watts, zones) {
  if (!zones || watts == null) return null;

  for (const key of ['z1', 'z2', 'z3', 'z4', 'z5a', 'z5b', 'z5c']) {
    const zone = zones[key];
    if (!zone) continue;
    const aboveMin = watts >= zone.min;
    const belowMax = zone.max === null || watts <= zone.max;
    if (aboveMin && belowMax) return key;
  }

  return null;
}
