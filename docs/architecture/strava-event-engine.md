# Strava Event Engine — Arquitetura

## Visão Geral

A Strava Event Engine é uma plataforma hub que conecta uma única integração OAuth com o Strava a múltiplos módulos independentes. Cada módulo implementa uma lógica de negócio específica e opera sobre os dados de atividades de um atleta dentro do contexto de um evento.

**Terminologia:**
- **Engine** — o framework/estrutura da plataforma
- **Módulo** — modelo de serviço (definido pelo provider): 1 módulo → n eventos
- **Evento** — configuração do módulo (definida pelo owner): 1 evento = 1 módulo
- **Slug** — sempre o slug do evento, nunca do módulo

---

## Princípios

- **Determinismo:** o mesmo conjunto de dados sempre produz o mesmo resultado
- **Idempotência:** reprocessar uma atividade não causa efeitos colaterais
- **Economia de API:** no máximo 1 PUT por atividade processada
- **Soberania do atleta:** o texto original nunca é modificado
- **Modularidade:** módulos são independentes, o worker não conhece sua lógica interna
- **Separação de responsabilidades:** worker = coletor, dispatcher = processador

---

## Stack

| Componente | Tecnologia |
|---|---|
| Framework | Next.js (App Router) |
| Banco de dados | Neon (PostgreSQL serverless) |
| Query | `pg` (Pool direto, sem ORM) |
| Deploy | Vercel |
| Auth | OAuth 2.0 via Strava |

---

## Estrutura de Diretórios

```
src/
  app/
    [slug]/
      page.js                      ← redirect por requires_registration
      register/page.js             ← inscrição via OAuth Strava
      dashboard/
        page.js                    ← dispatcher server component
        AgendaDashboard.jsx        ← dashboard do módulo Agenda
        EstimatorDashboard.jsx     ← dashboard do módulo Estimator
    api/
      auth/strava/
        start/route.js             ← inicia OAuth
        callback/route.js          ← finaliza OAuth, salva atleta, dispara backfill
      agenda/
        [slug]/route.js            ← GET dados do dashboard Agenda
        backfill/route.js          ← POST backfill histórico de atividades
      estimator/
        [slug]/route.js            ← GET configs do evento Estimator (público)
      events/
        route.js
        create/route.js
      internal/
        strava-worker/route.js     ← COLETOR de dados brutos
        module-dispatcher/route.js ← PROCESSADOR por módulo
        validate-access/route.js
        role/route.js
      stravaWebhook/route.js       ← recebe webhooks do Strava
    provider/
      page.js, layout.js, ...      ← área restrita do provider
  engine/
    modules/
      agenda/
        index.js                   ← constantes (ACCEPTED_SPORT_TYPES, REPROCESS_ON_DELETE)
        buildDescription.js        ← gera bloco de texto para a descrição
        computeDashboard.js        ← agrega dados para o dashboard
        computeTotals.js           ← calcula totais do período
    moduleRunner.js                ← executor genérico de módulos
    mergeDescription.js            ← agrega blocos e monta descrição final
  lib/
    db.js                          ← pool PostgreSQL
    strava.js                      ← getValidAccessToken (com refresh automático)
    events.js                      ← helpers de eventos
middleware.js                      ← proteção /provider e /api/internal
```

---

## Roles

Definidos internamente pela engine. O Strava é apenas provedor de identidade.

| Role | Descrição |
|---|---|
| `provider` | Proprietário da plataforma (IP holder) |
| `owner` | Criador e mantenedor do evento |
| `admin` | Designado pelo owner |
| `user` | Participante do evento |

Armazenado em `athlete_events.role`. Roles superiores nunca são rebaixados por novo login.

---

## Pipeline de Processamento

```
Strava
│
│  webhook (activity.create / update / delete)
▼
/api/stravaWebhook
│  Grava em strava_events (auditoria)
│  UPSERT activities (strava_id + aspect_type mínimo)
│  Loop guard → ignora se engine fez PUT há < 120s
│  Enfileira em activity_processing_queue
│    CREATE/UPDATE → next_run_at = now + 300s
│    DELETE        → next_run_at = now
│  Dispara worker (fire-and-forget)
▼
[aguarda delay de estabilização]
▼
/api/internal/strava-worker  (COLETOR)
│  Busca itens prontos na queue (next_run_at <= now)
│  Para cada activity:
│    DELETE → marca last_webhook_aspect, remove da queue
│             remoção física: TO DO (manutenção de banco)
│    CREATE/UPDATE:
│      GET /activities/:id no Strava (dados brutos)
│      UPSERT activities (dados completos)
│      UPSERT gear em athlete_gears
│      Detecta duplicata → marca duplicate_of, pula
│      UPSERT event_activities para cada evento ativo do atleta
│      Dispara dispatcher (fire-and-forget)
▼
/api/internal/module-dispatcher  (PROCESSADOR)
│  Busca event_activities pendentes (processed = false)
│  Para cada evento:
│    Filtra por ACCEPTED_SPORT_TYPES do módulo
│    consolidate() → busca dados do banco
│    build() → gera descriptionBlock
│    Marca metadata do módulo como processado
│  mergeDescription() → monta descrição final
│  PUT /activities/:id no Strava (se houve mudança)
│  Atualiza engine_last_put_at (loop guard)
│  Marca event_activities.processed = true
```

---

## Fluxo de Inscrição

```
Atleta acessa /[slug]
│
├─ requires_registration = false → /[slug]/dashboard (sem login obrigatório)
└─ requires_registration = true  → /[slug]/register
▼
/api/auth/strava/start
▼
Strava OAuth
▼
/api/auth/strava/callback
│  UPSERT athletes (tokens, scopes)
│  Determina role: provider > owner > user
│  UPSERT athlete_events (sem downgrade de role superior)
│  Se módulo = agenda:
│    UPSERT agenda_goals (metas)
│    POST /api/agenda/backfill (fire-and-forget)
│  Set cookie session = strava_id
▼
Redirect → /[slug]
```

---

## Módulos Registrados

| Módulo | Slug | ID | requires_registration | REPROCESS_ON_DELETE |
|---|---|---|---|---|
| Agenda de Treinos | `agenda` | 1 | true | true |
| Estimator | `estimator` | 3 | false | false |

Para adicionar um novo módulo ao dispatcher: adicionar entrada em `MODULE_REGISTRY`
em `src/app/api/internal/module-dispatcher/route.js`. Nenhum outro arquivo precisa ser alterado.

---

## Rotas e Autenticação

### Middleware

| Rota | Proteção |
|---|---|
| `/provider/*` | Cookie `provider_session` via `?key=<PROVIDER_SECRET>` |
| `/api/internal/*` | Header `Authorization: Bearer <INTERNAL_WORKER_SECRET>` |

### Rotas públicas

| Rota | Método | Descrição |
|---|---|---|
| `/api/auth/strava/start` | GET | Inicia OAuth |
| `/api/auth/strava/callback` | GET | Finaliza OAuth |
| `/api/stravaWebhook` | GET/POST | Webhook do Strava |
| `/api/estimator/[slug]` | GET | Configs do evento (público) |
| `/[slug]` | GET | Redirect por sessão/módulo |
| `/[slug]/register` | GET | Página de inscrição |
| `/[slug]/dashboard` | GET | Dashboard do módulo |
