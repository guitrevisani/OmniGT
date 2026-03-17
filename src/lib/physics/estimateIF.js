/**
 * ============================================================
 * src/lib/physics/estimateIF.js
 * ============================================================
 *
 * Calcula o Intensity Factor (IF) de uma atividade.
 *
 *   IF = NP / FTP
 *
 * Onde:
 *   NP  = Normalized Power (medida ou estimada via estimateNP)
 *   FTP = Functional Threshold Power (informado ou estimado via estimateFTP)
 *
 * Retorno:
 *   { if: number, npEstimated: boolean, ftpEstimated: boolean }
 *
 *   if:           valor arredondado a 2 casas decimais
 *   npEstimated:  true se NP veio de estimateNP (sem sensor)
 *   ftpEstimated: true se FTP não foi informado diretamente
 *
 * ============================================================
 */

/**
 * @param {object} options
 * @param {number} options.np              NP em watts (medida ou estimada)
 * @param {number} options.ftp             FTP em watts
 * @param {boolean} options.npEstimated    true se NP foi estimada via física
 * @param {string}  options.ftpMethod      método usado em estimateFTP
 * @returns {{ if: number, npEstimated: boolean, ftpEstimated: boolean }}
 */
export function calculateIF({ np, ftp, npEstimated = false, ftpMethod = 'informed' }) {
  if (!ftp || ftp <= 0) throw new Error('FTP inválido para cálculo de IF');
  if (!np  || np  <  0) throw new Error('NP inválida para cálculo de IF');

  return {
    if:           Math.round((np / ftp) * 100) / 100,
    npEstimated,
    ftpEstimated: ftpMethod !== 'informed',
  };
}
