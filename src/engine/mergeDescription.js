/**
 * ============================================================
 * DESCRIPTION AGGREGATOR
 * ============================================================
 *
 * Responsável por montar o bloco da engine na descrição
 * da atividade do Strava.
 *
 * Regras fundamentais:
 * - O texto original do atleta NUNCA é modificado
 * - A engine insere apenas no final da descrição
 * - Apenas UM bloco da engine pode existir por vez
 * - Se já existir um bloco anterior, é substituído
 * - Se o atleta removeu o bloco, a engine NÃO reinsere
 *   (description nunca é campo sensível — remoção pelo
 *    atleta não dispara reprocessamento)
 *
 * Formato do bloco:
 *
 * ===============================
 * [Evento A]
 * 🚴🏼 4354/22000
 * ⏱️ 179:08
 * 🗓️ 59 dias ativos
 *
 * [Evento B]
 * descrição do módulo B
 * ======================= OGT ===
 *
 * ============================================================
 */

const BLOCK_START = "===============================";
const BLOCK_END   = "======================= OGT ===";

/**
 * Verifica se a descrição atual contém um bloco da engine.
 */
export function hasEngineBlock(description) {
  if (!description) return false;
  return description.includes(BLOCK_START) && description.includes(BLOCK_END);
}

/**
 * Remove o bloco da engine de uma descrição, preservando
 * o texto original do atleta.
 *
 * @param {string} description
 * @returns {string} texto do atleta sem o bloco da engine
 */
export function removeEngineBlock(description) {
  if (!description) return "";

  const startIdx = description.indexOf(BLOCK_START);
  if (startIdx === -1) return description;

  // Remove o bloco e qualquer linha em branco imediatamente antes dele
  const before = description.slice(0, startIdx).trimEnd();
  return before;
}

/**
 * Monta a descrição final com o bloco da engine.
 *
 * @param {string}   originalDescription  Descrição atual da atividade no Strava
 * @param {string[]} moduleOutputs        Blocos gerados pelos módulos (apenas não-vazios)
 * @returns {string|null} Nova descrição, ou null se não há nada a inserir
 */
export function mergeDescription(originalDescription, moduleOutputs = []) {
  const validOutputs = moduleOutputs.filter(o => o && o.trim().length > 0);

  // Nenhum módulo gerou saída → sem alteração
  if (validOutputs.length === 0) return null;

  // Remove bloco anterior se existir
  const athleteText = removeEngineBlock(originalDescription || "");

  // Monta o bloco da engine
  const blockContent = validOutputs.join("\n\n");
  const engineBlock  = `${BLOCK_START}\n\n${blockContent}\n\n${BLOCK_END}`;

  // Concatena: texto do atleta (se houver) + 2 linhas em branco + bloco
  if (athleteText.length > 0) {
    return `${athleteText}\n\n\n${engineBlock}`;
  }

  return engineBlock;
}
