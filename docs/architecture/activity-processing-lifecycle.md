# Activity Processing Lifecycle

Descreve o ciclo completo de vida de uma atividade dentro da engine,
desde o recebimento do webhook até a atualização da descrição no Strava
e o disparo de notificação push.

---

## Políticas de Temporização

### Delay de estabilização (300s) — CREATE/UPDATE

Webhooks do Strava chegam em sequência quando o atleta edita uma atividade.
O delay garante que todas as edições sejam coalescidas em um único processamento.
A fila é deduplicada por `strava_activity_id` — múltiplos webhooks apenas atualizam `next_run_at`.

### Loop guard (120s) — PUT da engine

A engine faz PUT na descrição da atividade, o que gera um webhook `update` do Strava.
Após cada PUT, a engine registra `engine_last_put_at`. Webhooks recebidos dentro de
**120 segundos** desse timestamp são descartados pelo handler antes de entrar na fila.

### DELETE — sem delay

Deleções entram na fila imediatamente (`next_run_at = now`). Não há necessidade
de estabilização — o atleta não continua editando uma atividade deletada.

---

## Fluxo Completo

```
Strava
│
│  webhook: activity.create / update / delete
▼
/api/stravaWebhook
│  1. Ignora eventos não-activity
│  2. Grava payload em strava_events (auditoria)
│  3. UPSERT activities (strava_id + aspect_type + timestamps)
│  4. Loop guard: descarta se engine_last_put_at < 120s
│  5. Enfileira: CREATE/UPDATE → +300s / DELETE → now
│  6. Dispara worker (fire-and-forget)
▼
[aguarda delay]
▼
/api/internal/strava-worker  (COLETOR — não conhece módulos)
│
│  SELECT queue WHERE next_run_at <= now LIMIT 20
│
├─ aspect_type = 'delete'?
│   ├─ Para cada evento ativo do atleta com REPROCESS_ON_DELETE = true:
│   │    reenfileira atividades posteriores à start_date da atividade deletada
│   ├─ DELETE event_module_processing
│   ├─ DELETE event_activities
│   └─ DELETE activities
│
└─ CREATE/UPDATE:
    │  GET /activities/:id  ← Strava API (dados brutos frescos)
    │  UPDATE activities (campos completos: distância, tempo, elevação, gear, watts…)
    │  UPSERT athlete_gears (se gear_id presente — só chama API se gear não existe)
    │  Detecta duplicata por device_name + start_date + moving_time
    │    → duplicata: marca duplicate_of, remove da queue, pula
    │  Para cada evento ativo do atleta:
    │    Filtra sport_type por ACCEPTED_SPORT_TYPES do módulo
    │    INSERT event_activities (processed=false)
    │      ON CONFLICT DO UPDATE SET processed = false
    │  Remove da queue
    │  Dispara dispatcher (fire-and-forget)
▼
/api/internal/module-dispatcher  (PROCESSADOR)
│
│  SELECT event_activities WHERE processed = false
│    JOIN events + modules
│
│  GET /activities/:id  ← Strava API (para sport_type e description original)
│
│  Para cada evento pendente:
│    Filtra sport_type por ACCEPTED_SPORT_TYPES do módulo
│    consolidate(context) → busca dados do banco (agenda_daily + agenda_goals)
│    build(data, context) → computeTotals() + buildDescription() → string block
│    Atualiza metadata: { module_slug: true }
│
│  mergeDescription(originalDescription, blocks[])
│    → null se nenhum bloco gerado (sem PUT)
│
│  PUT /activities/:id  ← Strava API
│  UPDATE activities SET engine_last_put_at = NOW()
│  UPDATE event_activities SET processed = true
│
│  Para cada evento processado:
│    sendPushNotification(eventId, eventName)
│      → lê push_heading / push_body de events (fallback: textos padrão)
│      → filtra por tag event_<slug> no OneSignal
│      → POST /api/v1/notifications (fire-and-forget)
```

---

## Contrato do module-dispatcher

O dispatcher mantém seu próprio `MODULE_REGISTRY` com dois métodos por módulo:

```js
{
  agenda: {
    acceptedSportTypes: [...],

    // Busca dados consolidados do banco para o módulo
    async consolidate(context) {
      // context: { stravaId, eventId, eventName, startDate, endDate }
      // retorna: { daily: [...] }
    },

    // Gera o bloco de texto para a descrição da atividade
    build(data, context) {
      // data: retorno de consolidate()
      // retorna: string (bloco de descrição)
    },
  }
}
```

`mergeDescription` recebe `string[]` — cada elemento é o retorno de `build()`.

---

## Notificação Push

Disparada pelo dispatcher após cada PUT bem-sucedido no Strava, para cada evento processado.

- **Segmentação:** apenas devices com tag `event_<slug> = true` recebem
- **Textos:** configuráveis por evento em `events.push_heading` / `events.push_body`
- **Fallback:** `"OGT Event Engine"` / `"Nova atividade processada e descrição atualizada."`
- **Fire-and-forget:** erros de push não afetam o fluxo principal

---

## Detecção de Duplicatas

| Critério | Tolerância |
|---|---|
| Mesmo `strava_id` | — |
| `device_name` diferente | — |
| `start_date` | ±5 minutos |
| `end_date` (start + elapsed_time) | ±5 minutos |
| `moving_time` | ±10% |

A atividade com **maior `moving_time`** é mantida como original.
Se a atividade atual tiver maior `moving_time`, a candidata é marcada como duplicata no banco
e o processamento da atividade atual continua normalmente.

---

## Exclusão de Atividades

Quando `aspect_type = "delete"`:

1. Worker busca eventos ativos do atleta
2. Para módulos com `REPROCESS_ON_DELETE = true` (ex: `agenda`): reenfileira todas as
   atividades do atleta naquele evento com `start_date >= start_date da atividade deletada`
3. Remove `event_module_processing`, `event_activities` e `activities` em cascata
4. Remove da queue

O reprocessamento garante que os totais do módulo sejam recalculados após a remoção.

---

## Fluxo de Backfill (inscrição)

```
/api/auth/strava/callback
│
└─ POST /api/agenda/backfill (fire-and-forget, apenas módulo agenda)
   │
   │  GET /athlete/activities?after=event.start_date  ← Strava API
   │  paginado (200/página, até 10 páginas, 1s delay entre páginas)
   ▼
   UPSERT activities
   UPSERT event_activities
   UPSERT agenda_daily (consolidação por dia)
```

O backfill não faz PUT no Strava — apenas consolida dados históricos para o dashboard.
O atleta também pode disparar o backfill manualmente pelo dashboard via botão de sincronização
(`POST /api/agenda/sync`).
