/**
 * ============================================================
 * src/lib/physics/estimatePower.js
 * ============================================================
 *
 * Estima a Normalized Power (NP) de uma atividade.
 *
 * Hierarquia:
 *   1. Sensor (weighted_average_watts) — chamador passa direto, não passa por aqui
 *   2. Derivado do IF (estimateLoad) → NP = IF × FTP
 *   3. Cinemático — fallback extremo, sem dados de FC
 *
 * ============================================================
 */

const KINEMATIC_DEFAULTS = {
  mass_kg: 85,
  cda:     0.32,
  crr:     0.004,
  rho:     1.225,
  eta:     0.976,
  g:       9.8067,
};

/**
 * Deriva NP a partir do IF e FTP.
 * Usado quando TSS e IF vêm do estimateLoad (TRIMP).
 */
function estimateFromIF({ ifValue, ftp }) {
  if (!ifValue || !ftp || ftp <= 0) return null;
  return Math.round(ifValue * ftp);
}

/**
 * Estima NP via modelo cinemático — fallback extremo.
 * Não confiável sem dados segmento a segmento.
 */
function estimateFromKinematics({ distanceM, movingTimeSec, elevationGainM, params = {} }) {
  if (!distanceM || !movingTimeSec || movingTimeSec <= 0) return 0;

  const { mass_kg, cda, crr, rho, eta, g } = { ...KINEMATIC_DEFAULTS, ...params };

  const vMs   = distanceM / movingTimeSec;
  const grade = elevationGainM / distanceM;
  const angle = Math.atan(grade);

  const fGrav = mass_kg * g * Math.sin(angle);
  const fRoll = mass_kg * g * crr * Math.cos(angle);
  const fAero = 0.5 * cda * rho * vMs * vMs;

  return Math.round(Math.max(0, (fGrav + fRoll + fAero) * vMs / eta));
}

/**
 * Estima NP quando não há sensor de potência.
 *
 * @param {object} options
 * @param {number|null} options.ifValue        IF derivado do TRIMP (estimateLoad)
 * @param {number|null} options.ftp            FTP do atleta
 * @param {number}      options.distanceM      Distância em metros
 * @param {number}      options.movingTimeSec  Tempo em movimento em segundos
 * @param {number}      options.elevationGainM Ganho de elevação em metros
 * @param {object}      [options.params]       Overrides físicos (cinemático)
 *
 * @returns {{ np: number, method: 'if_derived' | 'kinematic' }}
 */
export function estimatePower({
  ifValue,
  ftp,
  distanceM,
  movingTimeSec,
  elevationGainM,
  params = {},
}) {
  // 1. Derivado do IF (TRIMP)
  const fromIF = estimateFromIF({ ifValue, ftp });
  if (fromIF !== null) {
    return { np: fromIF, method: 'if_derived' };
  }

  // 2. Cinemático
  return {
    np:     estimateFromKinematics({ distanceM, movingTimeSec, elevationGainM, params }),
    method: 'kinematic',
  };
}
