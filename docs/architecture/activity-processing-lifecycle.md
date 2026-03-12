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
│   └─ marca last_webhook_aspect, remove da queue
│
└─ CREATE/UPDATE:
    │  GET /activities/:id  ← Strava API (dados brutos frescos)
    │  UPSERT activities (campos completos)
    │  UPSERT athlete_gears (se gear_id presente)
    │  Detecta duplicata por device_name + start_date + moving_time
    │    → duplicata: marca duplicate_of, remove da queue, pula
    │  UPSERT event_activities (processed=false) para cada evento ativo
    │  Remove da queue
    │  Dispara dispatcher (fire-and-forget)
▼
/api/internal/module-dispatcher  (PROCESSADOR)
│
│  SELECT event_activities WHERE processed = false
│
│  Para cada evento:
│    Filtra sport_type por ACCEPTED_SPORT_TYPES do módulo
│    consolidate(context) → busca dados do banco
│    build(data, context) → gera descriptionBlock
│    Atualiza metadata: { module_slug: true }
│
│  mergeDescription(originalDescription, outputs[])
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

---

## Exclusão de Atividades

Quando `aspect_type = "delete"`:

1. Worker marca `last_webhook_aspect = 'delete'`
2. Remove da fila — sem processamento de módulos
3. Remoção física: **TO DO** (job de manutenção)

**REPROCESS_ON_DELETE** (configurado por módulo em `index.js`):
- Módulo `agenda`: `REPROCESS_ON_DELETE = true` — reprocessamento após delete **não implementado** ainda.

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
