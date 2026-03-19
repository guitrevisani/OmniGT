/**
 * ============================================================
 * src/lib/physics/estimatePower.js
 * ============================================================
 *
 * Estima a Normalized Power (NP) de uma atividade quando não
 * há sensor de potência, em ordem de precisão:
 *
 *   1. FC média (average_heartrate) via fórmula Coggan:
 *        %FTP = (%FCmáx - 37) / 0.63
 *        NP   = FTP × %FTP
 *      Requer: averageHeartrate, hrMax, ftp
 *
 *   2. Cinemático (fallback degradado):
 *        P = (F_grav + F_roll + F_aero) × v / eta
 *      Pouco confiável sem dados segmento a segmento.
 *      Usado apenas quando FC não está disponível.
 *
 * FCmáx: informada pelo atleta > Tanaka (208 - 0.7 × idade) > default 183
 *
 * @param {object} options
 * @param {number|null} options.averageHeartrate  FC média da atividade (bpm)
 * @param {number|null} options.hrMax             FCmáx do atleta (bpm)
 * @param {number|null} options.age               Idade do atleta (anos)
 * @param {number}      options.ftp               FTP em watts
 * @param {number}      options.distanceM         Distância total em metros
 * @param {number}      options.movingTimeSec     Tempo em movimento em segundos
 * @param {number}      options.elevationGainM    Ganho de elevação em metros
 * @param {object}      [options.params]          Overrides físicos (cinemático)
 *
 * @returns {{ np: number, method: 'heartrate' | 'kinematic' }}
 */

const KINEMATIC_DEFAULTS = {
  mass_kg: 85,
  cda:     0.32,
  crr:     0.004,
  rho:     1.225,
  eta:     0.976,
  g:       9.8067,
};

function resolveHrMax(hrMax, age) {
  if (hrMax && hrMax > 0) return hrMax;
  const a = age && age > 0 ? age : 35;
  return Math.round(208 - 0.7 * a);
}

function estimateFromHeartrate({ averageHeartrate, hrMax, age, ftp }) {
  if (!averageHeartrate || !ftp || ftp <= 0) return null;

  const hrMaxResolved = resolveHrMax(hrMax, age);
  const pctHrMax      = averageHeartrate / hrMaxResolved;
  const pctFtp        = (pctHrMax - 0.37) / 0.63;

  // Abaixo de ~37% FCmáx a relação não é válida
  if (pctFtp <= 0) return null;

  return Math.round(ftp * pctFtp);
}

function estimateFromKinematics({ distanceM, movingTimeSec, elevationGainM, params = {} }) {
  if (!distanceM || !movingTimeSec || movingTimeSec <= 0) return 0;

  const { mass_kg, cda, crr, rho, eta, g } = { ...KINEMATIC_DEFAULTS, ...params };

  const vMs      = distanceM / movingTimeSec;
  const grade    = elevationGainM / distanceM;
  const angle    = Math.atan(grade);

  const fGrav  = mass_kg * g * Math.sin(angle);
  const fRoll  = mass_kg * g * crr * Math.cos(angle);
  const fAero  = 0.5 * cda * rho * vMs * vMs;

  return Math.round(Math.max(0, (fGrav + fRoll + fAero) * vMs / eta));
}

export function estimatePower({
  averageHeartrate,
  hrMax,
  age,
  ftp,
  distanceM,
  movingTimeSec,
  elevationGainM,
  params = {},
}) {
  const fromHr = estimateFromHeartrate({ averageHeartrate, hrMax, age, ftp });
  if (fromHr !== null) {
    return { np: fromHr, method: 'heartrate' };
  }

  return {
    np:     estimateFromKinematics({ distanceM, movingTimeSec, elevationGainM, params }),
    method: 'kinematic',
  };
}
