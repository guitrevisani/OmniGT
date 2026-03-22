/**
 * ============================================================
 * src/lib/physics/estimateLoad.js
 * ============================================================
 *
 * Estima a carga de treinamento (TSS e IF) de uma atividade
 * via TRIMP de Banister normalizado.
 *
 * Fórmula TRIMP:
 *   FC_reserva = (FC - hr_min) / (hr_max - hr_min)
 *   TRIMP      = t_min × FC_reserva × 0.64 × e^(k × FC_reserva)
 *   k = 1.92 (masculino) | 1.67 (feminino)
 *
 * Normalização:
 *   TRIMP_ref = TRIMP de 1h no limiar (hr_limiar) → equivale a TSS=100
 *   TSS       = (TRIMP / TRIMP_ref) × 100
 *   IF        = sqrt(TSS × 3600 / (t_sec × 100))
 *
 * Hierarquia de dados para TSS:
 *   1. Stream de FC (hr_stream) — FC média real segundo a segundo
 *   2. FC média da atividade (average_heartrate)
 *   3. Fallback: sem FC → retorna null (caller usa cinemático)
 *
 * Defaults quando dados do atleta não disponíveis:
 *   hr_min:    estimado por Tanaka repouso = round((208 - 0.7×idade) × 0.35)
 *              ou 45 bpm se idade não disponível
 *   hr_limiar: 90% de hr_max
 *   hr_max:    Tanaka = round(208 - 0.7×idade) ou 183 se idade não disponível
 *
 * ============================================================
 */

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_AGE          = 35;
const HR_LIMIAR_PCT_HRMAX  = 0.90;   // fallback quando hr_zones não disponível
const HR_MIN_PCT_HRMAX     = 0.35;   // estimativa FC repouso via Tanaka

function resolveHrMax(hrMax, age) {
  if (hrMax && hrMax > 0) return hrMax;
  return Math.round(208 - 0.7 * (age || DEFAULT_AGE));
}

function resolveHrMin(hrMin, hrMax, age) {
  if (hrMin && hrMin > 0) return hrMin;
  const max = resolveHrMax(hrMax, age);
  return Math.round(max * HR_MIN_PCT_HRMAX);
}

function resolveHrLimiar(hrLimiar, hrZones, hrMax, age) {
  if (hrLimiar && hrLimiar > 0) return hrLimiar;
  // Z4 máx = hr_zones[3]
  if (hrZones?.length >= 4 && hrZones[3] > 0) return hrZones[3];
  const max = resolveHrMax(hrMax, age);
  return Math.round(max * HR_LIMIAR_PCT_HRMAX);
}

// ─── TRIMP ────────────────────────────────────────────────────────────────────

function fcReserva(hr, hrMin, hrMax) {
  if (hrMax <= hrMin) return 0;
  return Math.max(0, (hr - hrMin) / (hrMax - hrMin));
}

function trimpValue(tSec, hrMedia, hrMin, hrMax, gender) {
  const k      = gender === 'feminino' ? 1.67 : 1.92;
  const fcRes  = fcReserva(hrMedia, hrMin, hrMax);
  if (fcRes <= 0) return 0;
  return (tSec / 60) * fcRes * 0.64 * Math.exp(k * fcRes);
}

function trimpRef(hrLimiar, hrMin, hrMax, gender) {
  return trimpValue(3600, hrLimiar, hrMin, hrMax, gender);
}

// ─── FC média do stream ────────────────────────────────────────────────────────

function hrMeanFromStream(hrStream) {
  if (!hrStream?.length) return null;
  return hrStream.reduce((a, b) => a + b, 0) / hrStream.length;
}

// ─── Cálculo principal ────────────────────────────────────────────────────────

/**
 * Estima TSS e IF via TRIMP normalizado.
 *
 * @param {object} options
 * @param {number[]|null} options.hrStream          Stream de FC segundo a segundo
 * @param {number|null}   options.averageHeartrate  FC média da atividade
 * @param {number|null}   options.hrMin             FC mínima persistida do atleta
 * @param {number|null}   options.hrMax             FCmáx do atleta
 * @param {number|null}   options.hrLimiar          FC no limiar anaeróbico
 * @param {number[]|null} options.hrZones           [z1_max..z5_max] — fallback hr_limiar
 * @param {number|null}   options.age               Idade do atleta
 * @param {string}        options.gender            'masculino' | 'feminino'
 * @param {number}        options.movingTimeSec     Tempo em movimento em segundos
 *
 * @returns {{ tss: number, ifValue: number, hrMedia: number, method: string } | null}
 *          null se sem dados de FC
 */
export function estimateLoad({
  hrStream,
  averageHeartrate,
  hrMin,
  hrMax,
  hrLimiar,
  hrZones,
  age,
  gender = 'masculino',
  movingTimeSec,
}) {
  if (!movingTimeSec || movingTimeSec <= 0) return null;

  // FC média — stream tem prioridade
  const hrMedia = hrMeanFromStream(hrStream) ?? averageHeartrate ?? null;
  if (!hrMedia || hrMedia <= 0) return null;

  const method = hrStream?.length ? 'trimp_stream' : 'trimp_mean';

  // Resolver parâmetros do atleta
  const hrMaxR     = resolveHrMax(hrMax, age);
  const hrMinR     = resolveHrMin(hrMin, hrMax, age);
  const hrLimiarR  = resolveHrLimiar(hrLimiar, hrZones, hrMax, age);

  const ref = trimpRef(hrLimiarR, hrMinR, hrMaxR, gender);
  if (ref <= 0) return null;

  const trimp  = trimpValue(movingTimeSec, hrMedia, hrMinR, hrMaxR, gender);
  const tss    = Math.max(0, (trimp / ref) * 100);
  const ifValue = Math.sqrt(tss * 3600 / (movingTimeSec * 100));

  return {
    tss:     Math.round(tss),
    ifValue: Math.round(ifValue * 100) / 100,
    hrMedia: Math.round(hrMedia * 10) / 10,
    method,
  };
}
