# ADR-001 — Activity-Centered Processing

**Status:** Accepted

---

## Contexto

Webhooks do Strava podem gerar múltiplos eventos para a mesma atividade. Quando um atleta cria uma atividade e edita título, descrição e distância em sequência, o Strava envia um `create` seguido de vários `update`. Sem controle adequado isso causa processamento redundante e inconsistências.

## Decisão

A unidade de processamento da engine é o `strava_activity_id`. A fila `activity_processing_queue` é deduplicada por esse identificador — múltiplos webhooks para a mesma atividade resultam em um único job.

**Políticas de temporização:**
- **CREATE/UPDATE:** delay de **300 segundos** antes da execução (estabilização)
- **DELETE:** sem delay — entra na fila imediatamente
- **Loop guard:** webhooks recebidos dentro de **120 segundos** após um PUT da engine são descartados

## Consequências

**Benefícios:**
- Processamento determinístico e idempotente
- Redução de chamadas à API do Strava
- Eliminação de loops de execução

**Trade-offs:**
- Latência de até 5 minutos entre o evento e a atualização da descrição
- Comportamento esperado: edições rápidas do atleta são coalescidas em um único processamento
