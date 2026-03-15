/**
 * ============================================================
 * AGENDA MODULE — buildDescription
 * ============================================================
 *
 * Gera o bloco de texto do módulo Agenda para inserção
 * na descrição da atividade pelo Description Aggregator.
 *
 * Formato de saída:
 *
 * [Nome do Evento]
 * 🚴🏼 4354/22000
 * ⏱️ 179:08          ← regressivo até meta; +HH:MM após
 * 🗓️ 59 dias ativos  ← omitido se activeDays === null
 *
 * Regras:
 * - distância: km inteiros, cresce ad infinitum
 * - tempo: regressivo a partir da meta; exibe +HH:MM após meta
 * - dias ativos: exibido apenas se activeDays !== null
 *   (null indica que o dia ainda não atingiu 900s de moving_time
 *   até e incluindo esta atividade — design intencional, não é
 *   atualizado retroativamente quando atividades posteriores
 *   completam o limite)
 * ============================================================
 */

export function buildDescription({ totals, context }) {
  const eventName = context?.event?.name || "Evento";

  const totalDistanceM     = totals?.totalDistanceM     || 0;
  const totalMovingTimeSec = totals?.totalMovingTimeSec  || 0;
  const goalDistanceKm     = Number(totals?.goalDistanceKm    || context?.event?.goals?.goal_distance_km    || 0);
  const goalMovingTimeSec  = Number(totals?.goalMovingTimeSec || context?.event?.goals?.goal_moving_time_sec || 0);
  const activeDays         = totals?.activeDays ?? null; // null = omitir linha

  // ── Distância ──────────────────────────────────────────────
  const distanceKm = Math.floor(totalDistanceM / 1000);
  const goalKm     = Math.floor(goalDistanceKm);
  const distLine   = `🚴🏼 ${distanceKm}/${goalKm}`;

  // ── Tempo (regressivo) ─────────────────────────────────────
  const remainingSec = goalMovingTimeSec - totalMovingTimeSec;
  let timeLine;

  if (remainingSec <= 0) {
    const exceededSec = Math.abs(remainingSec);
    const h = Math.floor(exceededSec / 3600);
    const m = Math.floor((exceededSec % 3600) / 60);
    timeLine = `⏱️ +${h}:${String(m).padStart(2, "0")}`;
  } else {
    const h = Math.floor(remainingSec / 3600);
    const m = Math.floor((remainingSec % 3600) / 60);
    timeLine = `⏱️ ${h}:${String(m).padStart(2, "0")}`;
  }

  // ── Dias ativos ────────────────────────────────────────────
  const lines = [
    `[${eventName}]`,
    distLine,
    timeLine,
  ];

  if (activeDays !== null) {
    const daysLabel = activeDays === 1 ? "1 dia ativo" : `${activeDays} dias ativos`;
    lines.push(`🗓️ ${daysLabel}`);
  }

  return lines.join("\n");
}
