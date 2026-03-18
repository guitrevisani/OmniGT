/**
 * ============================================================
 * src/lib/physics/calculateTSS.js
 * ============================================================
 *
 * Calcula o Training Stress Score (TSS) de uma atividade.
 *
 * Fórmula completa (Coggan/TrainingPeaks):
 *   TSS = (duration_sec × NP × IF) / (FTP × 3600) × 100
 *
 * Onde:
 *   duration_sec  = tempo em movimento em segundos
 *   NP            = Normalized Power em watts (medida ou estimada)
 *   IF            = Intensity Factor (NP / FTP)
 *   FTP           = Functional Threshold Power em watts
 *
 * Nota: o TSS calculado com NP ou FTP estimados representa o
 * impacto adicionado pelo camp, não o TSS real do atleta.
 * Sinalizado com asterisco (*) no bloco de descrição e com
 * disclaimer no dashboard.
 *
 * Classificação por atividade (Coggan):
 *   < 150   Baixo    — recuperado no dia seguinte
 *   150–300 Médio    — fadiga residual no dia seguinte
 *   300–450 Alto     — fadiga pode persistir após 2 dias
 *   > 450   Muito alto — fadiga por vários dias
 *
 * @param {object} options
 * @param {number} options.movingTimeSec  Tempo em movimento em segundos
 * @param {number} options.np             NP em watts
 * @param {number} options.ifValue        Intensity Factor
 * @param {number} options.ftp            FTP em watts
 * @returns {number} TSS arredondado para inteiro
 */
export function calculateTSS({ movingTimeSec, np, ifValue, ftp }) {
  if (!movingTimeSec || !np || !ifValue || !ftp || ftp <= 0) return 0;

  const tss = (movingTimeSec * np * ifValue) / (ftp * 3600) * 100;
  return Math.round(Math.max(0, tss));
}
