# ADR-004 — Política de Timezone

**Status:** Accepted

---

## Contexto

O Brasil possui quatro fusos horários. Fixar um timezone único causaria agrupamentos incorretos para atletas fora do fuso de Brasília.

## Decisão

A engine **não define timezone fixo** em queries SQL. Nenhum `SET TIME ZONE` é executado.

Datas de atividades são armazenadas como recebidas do Strava (`start_date` em UTC). O agrupamento por dia em `agenda_daily` usa a data UTC como padrão neutro para o MVP.

## Consequências

- Comportamento consistente independentemente do servidor de banco
- Para o MVP (atleta em Brasília UTC-3), impacto mínimo e aceitável
