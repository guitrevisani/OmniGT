/**
 * ============================================================
 * MODULE RUNNER
 * ============================================================
 *
 * Executor genérico de módulos da engine.
 * Orquestra: consolidate → builders → resultado padronizado.
 *
 * Objeto de saída padrão:
 * {
 *   module:           string
 *   descriptionBlock: string
 *   dashboard:        object | null
 *   totals:           object | null
 *   ranking:          object | null
 * }
 * ============================================================
 */

export async function runModule({ moduleName, context, consolidate, builders }) {
  const data = await consolidate(context);

  const result = {
    module:           moduleName,
    descriptionBlock: "",
    dashboard:        null,
    totals:           null,
    ranking:          null,
  };

  if (builders.computeTotals) {
    result.totals = await builders.computeTotals(data);
  }

  if (builders.computeDashboard) {
    result.dashboard = await builders.computeDashboard(data);
  }

  if (builders.computeRanking) {
    result.ranking = await builders.computeRanking(data);
  }

  if (builders.buildDescription) {
    // Passa totals + context para que buildDescription
    // tenha acesso ao nome do evento e às metas
    result.descriptionBlock = builders.buildDescription({
      ...data,
      totals:  result.totals,
      dashboard: result.dashboard,
      ranking:   result.ranking,
      context,   // ← nome do evento vem daqui
    });
  }

  return result;
}
