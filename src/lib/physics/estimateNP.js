/**
 * ============================================================
 * src/lib/physics/estimateNP.js
 * ============================================================
 *
 * Estima a Normalized Power (NP) de uma atividade a partir de
 * dados cinemáticos quando não há sensor de potência.
 *
 * Modelo físico:
 *   P = (F_grav + F_roll + F_aero) * v / eta
 *
 *   F_grav  = m * g * sin(atan(grade))        força gravitacional
 *   F_roll  = m * g * crr * cos(atan(grade))  resistência ao rolamento
 *   F_aero  = 0.5 * cda * rho * v²            resistência aerodinâmica
 *   eta     = eficiência do drivetrain
 *
 * NP estimada como potência média ponderada ao longo da atividade.
 * Sem dados segmento a segmento, usa velocidade média e elevação
 * média como aproximação. Imprecisão esperada: ±10–15%.
 *
 * Parâmetros físicos defaults:
 *   mass_kg  85    kg (atleta ~75kg + equipamento ~10kg)
 *   cda      0.32  m² (posição em cima do guidão, ciclismo estrada)
 *   crr      0.004 (pneu de estrada em asfalto)
 *   rho      1.225 kg/m³ (ar ao nível do mar, 15°C)
 *   eta      0.976 (eficiência drivetrain)
 *   g        9.8067 m/s²
 *
 * Uso:
 *   const np = estimateNP({ distanceM, movingTimeSec, elevationGainM, params })
 *
 * ============================================================
 */

const DEFAULTS = {
  mass_kg: 85,
  cda:     0.32,
  crr:     0.004,
  rho:     1.225,
  eta:     0.976,
  g:       9.8067,
};

/**
 * Estima NP a partir de dados cinemáticos agregados da atividade.
 *
 * @param {object} options
 * @param {number} options.distanceM       Distância total em metros
 * @param {number} options.movingTimeSec   Tempo em movimento em segundos
 * @param {number} options.elevationGainM  Ganho de elevação em metros
 * @param {object} [options.params]        Sobrescreve defaults físicos
 * @returns {number} NP estimada em watts (arredondado para inteiro)
 */
export function estimateNP({ distanceM, movingTimeSec, elevationGainM, params = {} }) {
  if (!distanceM || !movingTimeSec || movingTimeSec <= 0) return 0;

  const { mass_kg, cda, crr, rho, eta, g } = { ...DEFAULTS, ...params };

  const vMs       = distanceM / movingTimeSec;          // velocidade média em m/s
  const gradeMean = elevationGainM / distanceM;          // grade média (adimensional)
  const angle     = Math.atan(gradeMean);

  const fGrav  = mass_kg * g * Math.sin(angle);
  const fRoll  = mass_kg * g * crr * Math.cos(angle);
  const fAero  = 0.5 * cda * rho * vMs * vMs;

  const powerW = (fGrav + fRoll + fAero) * vMs / eta;

  return Math.round(Math.max(0, powerW));
}
