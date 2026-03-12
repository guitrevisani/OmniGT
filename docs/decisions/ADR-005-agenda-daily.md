# ADR-005 — Agregação Diária do Módulo Agenda

**Status:** Accepted

---

## Contexto

O módulo Agenda consolida atividades por dia. Decisão: o consolidado diário distingue ou não o equipamento (gear) utilizado?

## Decisão

O consolidado diário **não distingue equipamento**. Cada linha em `agenda_daily` representa o total do atleta naquele dia para aquele evento, independentemente da bicicleta utilizada.

Distinção por gear é relevante para análises futuras e será tratada em módulo ou relatório específico quando necessário.

## Consequências

- Schema simples: uma linha por `(event_id, strava_id, activity_date)`
- UNIQUE constraint garante idempotência dos upserts
- Consolidações são determinísticas e re-executáveis sem duplicação
