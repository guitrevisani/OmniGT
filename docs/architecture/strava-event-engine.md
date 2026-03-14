# Strava Event Engine — Arquitetura

## Visão Geral

A Strava Event Engine é uma plataforma hub que conecta uma única integração OAuth com o Strava
a múltiplos módulos independentes. Cada módulo implementa uma lógica de negócio específica
e opera sobre os dados de atividades de um atleta dentro do contexto de um evento.

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
| Push | OneSignal (Web Push) |

---

## Estrutura de Diretórios

```
src/
  app/
    [slug]/
      page.js                      ← redirect por requires_registration / sessão
      register/page.js             ← inscrição via OAuth Strava
      dashboard/
        page.js                    ← dispatcher server component
        AgendaDashboard.jsx        ← dashboard do módulo Agenda
        EstimatorDashboard.jsx     ← dashboard do módulo Estimator
    api/
      auth/strava/
        start/route.js             ← inicia OAuth
        callback/route.js          ← finaliza OAuth, cria sessão, dispara backfill
        logout/route.js            ← destroi sessão, limpa cookie
      agenda/
        [slug]/route.js            ← GET dados do dashboard Agenda
        backfill/route.js          ← POST backfill histórico de atividades
        sync/route.js              ← POST sync manual pelo atleta
      estimator/
        [slug]/route.js            ← GET configs do evento Estimator (público)
      events/
        route.js
        create/route.js
      push/
        register/route.js          ← POST registra player_id + aplica tags OneSignal
      internal/
        strava-worker/route.js     ← COLETOR de dados brutos (não conhece módulos)
        module-dispatcher/route.js ← PROCESSADOR por módulo + disparo de push
        validate-access/route.js
        role/route.js
      stravaWebhook/route.js       ← recebe webhooks do Strava
    provider/
      page.js, layout.js, ...      ← área restrita do provider
  components/
    OneSignalInit.jsx              ← inicialização global do SDK OneSignal
  engine/
    modules/
      agenda/
        index.js                   ← ACCEPTED_SPORT_TYPES, REPROCESS_ON_DELETE, consolidate
        buildDescription.js
        computeDashboard.js
        computeTotals.js
    moduleRunner.js                ← executor genérico (usado pelo dashboard, não pelo worker)
    mergeDescription.js            ← agrega blocos de módulos na descrição da atividade
  lib/
    db.js                          ← pool PostgreSQL
    strava.js                      ← getValidAccessToken (com refresh automático)
    events.js                      ← helpers de eventos
    session.js                     ← getSession / createSession / destroySession
middleware.js                      ← proteção /provider e /api/internal
public/
  OneSignalSDKWorker.js            ← service worker para push em background
```

---

## Sessões

Ver `docs/architecture/session-management.md` para detalhes completos.

O cookie `session` carrega um token UUID gerado no banco.
Nunca expõe `strava_id` diretamente.

---

## Notificações Push

Ver `docs/architecture/push-notifications.md` para detalhes completos.

OneSignal Web Push com segmentação programática via tags.
Disparo automático após PUT bem-sucedido no Strava.

---

## Roles

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
│  UPSERT activities
│  Loop guard → descarta se PUT < 120s atrás
│  Enfileira: CREATE/UPDATE → +300s / DELETE → now
│  Dispara worker (fire-and-forget)
▼
/api/internal/strava-worker  (COLETOR)
│  GET /activities/:id (Strava API)
│  UPDATE activities (campos completos)
│  UPSERT athlete_gears
│  Detecta duplicata
│  INSERT event_activities (processed=false) por evento ativo
│  Remove da queue
│  Dispara dispatcher (fire-and-forget)
▼
/api/internal/module-dispatcher  (PROCESSADOR)
│  SELECT event_activities WHERE processed = false
│  Para cada evento: consolidate() → build() → string block
│  mergeDescription(originalDescription, blocks[])
│  PUT /activities/:id (Strava API)
│  engine_last_put_at + processed=true
│  sendPushNotification() (fire-and-forget)
```

### Separação de responsabilidades worker/dispatcher

O `strava-worker` é intencionalmente ignorante de módulos. Ele sabe apenas:
- Quais `sport_types` cada módulo aceita (`ACCEPTED_SPORT_TYPES`) — para filtrar antes de criar `event_activities`
- Se o módulo reprocessa no DELETE (`REPROCESS_ON_DELETE`) — para reenfileirar atividades anteriores

Toda a lógica de consolidação de dados e geração de descrição pertence exclusivamente
ao `module-dispatcher`, que mantém seu próprio `MODULE_REGISTRY` com `consolidate` e `build` por módulo.

O `moduleRunner.js` e os builders do `engine/` são usados pelo dashboard (server components),
não pelo pipeline de webhook.

---

## Fluxo de Inscrição

```
Atleta acessa /[slug]
│
├─ requires_registration = false → /[slug]/dashboard
└─ requires_registration = true  → /[slug]/register
▼
/api/auth/strava/start (com params: event, keep_goals, goal_km, goal_hours, push_consent)
▼
Strava OAuth
▼
/api/auth/strava/callback
│  UPSERT athletes (tokens, scopes)
│  Determina role: provider > owner > user (sem downgrade)
│  UPSERT athlete_events (role, push_consent)
│  Se keep_goals=1 e metas existem → mantém agenda_goals
│  Se keep_goals=0 → UPSERT agenda_goals com novas metas
│  Se keep_goals=1 e sem metas → redireciona com ?warn=no_goals
│  createSession(stravaId, eventId, endDate) → token UUID
│  Set cookie session = token
│  Se módulo = agenda: POST /api/agenda/backfill (fire-and-forget)
▼
Redirect → /[slug]
```

---

## Módulos Registrados

| Módulo | Slug | ID | requires_registration | REPROCESS_ON_DELETE |
|---|---|---|---|---|
| Agenda de Treinos | `agenda` | 1 | true | true |
| Estimator | `estimator` | 3 | false | false |

Para adicionar um módulo ao dispatcher: adicionar entrada em `MODULE_REGISTRY`
em `src/app/api/internal/module-dispatcher/route.js`.

O worker só precisa de `ACCEPTED_SPORT_TYPES` e `REPROCESS_ON_DELETE` — exportados
pelo `index.js` de cada módulo.

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
| `/api/auth/strava/logout` | POST | Logout (destroi sessão) |
| `/api/stravaWebhook` | GET/POST | Webhook do Strava |
| `/api/estimator/[slug]` | GET | Configs do evento (público) |
| `/api/push/register` | POST | Registra device para push (requer sessão) |
| `/[slug]` | GET | Redirect por sessão/módulo |
| `/[slug]/register` | GET | Página de inscrição |
| `/[slug]/dashboard` | GET | Dashboard do módulo |
