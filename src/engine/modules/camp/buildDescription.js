/**
 * ============================================================
 * src/engine/modules/camp/buildDescription.js
 * ============================================================
 *
 * Gera o bloco de descrição do módulo Camp para inserção
 * na descrição da atividade pelo mergeDescription.
 *
 * Formato:
 *
 * [Nome do Camp]
 * Sessão d.s · Descrição sintética da sessão
 * 🚴🏼  89 km · 231 km camp
 * ↑  1.420 m · 3.840 m camp
 * ⏱  3:14 · 8:22 camp
 * IF 0.87 · NP 241W
 *
 * Regras:
 * - Linha de sessão omitida se dayNumber ou shortDescription forem null
 * - NP exibe tag "(estimado)" se npEstimated = true
 * - IF exibe tag "(estimado)" se ftpEstimated = true
 * - Distância em km inteiros
 * - Elevação em metros inteiros com separador de milhar
 * - Tempo no formato [h]:mm (horas omitidas se < 1h, exibe Xmin)
 * ============================================================
 */

/**
 * Formata tempo em segundos para [h]:mm ou Xmin.
 *
 * @param {number} totalSec
 * @returns {string}
 */
function formatTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}min`;
}

/**
 * Formata número inteiro com separador de milhar (ponto).
 *
 * @param {number} value
 * @returns {string}
 */
function formatInt(value) {
  return Math.round(value).toLocaleString('pt-BR');
}

/**
 * Gera o bloco de descrição do Camp.
 *
 * @param {object} options
 * @param {string}  options.eventName      Nome do camp
 * @param {object}  options.totals         Saída de computeTotals
 * @param {number}  options.np             NP em watts
 * @param {boolean} options.npEstimated    true se NP foi estimada via física
 * @param {number}  options.ifValue        Intensity Factor
 * @param {boolean} options.ftpEstimated   true se FTP não foi informado diretamente
 * @returns {string}
 */
export function buildDescription({
  eventName,
  totals,
  np,
  npEstimated,
  ifValue,
  ftpEstimated,
}) {
  const lines = [];

  // ── Linha 1: nome do camp ───────────────────────────────
  lines.push(`[${eventName}]`);

  // ── Linha 2: sessão (omitida se sem match) ──────────────
  if (totals.dayNumber != null && totals.shortDescription) {
    lines.push(`Sessão ${totals.dayNumber}.${totals.sessionOrder} · ${totals.shortDescription}`);
  }

  // ── Linha 3: distância ──────────────────────────────────
  const actKm  = Math.floor(totals.activityDistanceM / 1000);
  const campKm = Math.floor(totals.campDistanceM      / 1000);
  lines.push(`🚴🏼  ${actKm} km · ${campKm} km camp`);

  // ── Linha 4: elevação ───────────────────────────────────
  const actElev  = formatInt(totals.activityElevationM);
  const campElev = formatInt(totals.campElevationM);
  lines.push(`↑  ${actElev} m · ${campElev} m camp`);

  // ── Linha 5: tempo ──────────────────────────────────────
  const actTime  = formatTime(totals.activityMovingTimeSec);
  const campTime = formatTime(totals.campMovingTimeSec);
  lines.push(`⏱  ${actTime} · ${campTime} camp`);

  // ── Linha 6: IF · NP ────────────────────────────────────
  const ifStr = ifValue.toFixed(2);
  const ifTag = ftpEstimated ? ' (estimado)' : '';
  const npStr = Math.round(np);
  const npTag = npEstimated  ? ' (estimado)' : '';
  lines.push(`IF ${ifStr}${ifTag} · NP ${npStr}W${npTag}`);

  return lines.join('\n');
}
