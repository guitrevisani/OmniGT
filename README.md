# OGT Event Engine

Plataforma hub que conecta uma única integração OAuth com o Strava a múltiplos módulos independentes. Atletas se inscrevem em eventos e têm suas atividades processadas automaticamente — com consolidação de dados, dashboards e atualização da descrição das atividades.

---

## Stack

- **Next.js** (App Router) — frontend e API routes
- **Neon** (PostgreSQL serverless) — banco de dados
- **Vercel** — deploy e hosting
- **Strava OAuth 2.0** — autenticação e dados de atividades

---

## Módulos

| Módulo | Slug | Descrição |
|---|---|---|
| Agenda de Treinos | `agenda` | Consolida atividades de ciclismo. Gera métricas acumuladas, dashboard e bloco de descrição nas atividades. |

---

## Fluxo Principal

```
Atleta acessa /[slug]/register
  → OAuth Strava
  → Salva tokens + role + metas
  → Backfill histórico de atividades
  → Redireciona para /[slug]/dashboard

Nova atividade no Strava
  → Webhook → fila (delay 300s)
  → Worker: GET activity → módulos → mergeDescription → PUT activity
```

---

## Estrutura do Projeto

```
src/
  app/
    [slug]/
      page.js               ← redirect por sessão
      register/page.js      ← inscrição OAuth
      dashboard/page.js     ← dashboard do módulo Agenda
    api/
      auth/strava/start/    ← inicia OAuth
      auth/strava/callback/ ← finaliza OAuth
      agenda/backfill/      ← backfill histórico
      agenda/[slug]/        ← dados do dashboard
      stravaWebhook/        ← recebe webhooks do Strava
      internal/strava-worker/
  engine/
    modules/agenda/
      index.js
      buildDescription.js
      computeDashboard.js
      computeTotals.js
    moduleRunner.js
    mergeDescription.js
    resolveEvents.js
    loadModules.js
  lib/
    db.js
    strava.js
    events.js
scripts/
  testAgendaModule.js       ← teste isolado do módulo Agenda
middleware.js
```

---

## Saída do Módulo Agenda na Descrição

```
===============================
[Nome do Evento]
🚴🏼 4354/22000
⏱️ 179:08
🗓️ 59 dias ativos
======================= OGT ===
```

- `🚴🏼` km acumulados / meta (cresce além da meta)
- `⏱️` tempo restante para a meta de horas (regressivo); `+HH:MM` após atingir a meta
- `🗓️` dias com ≥ 15 min em movimento

O texto original do atleta nunca é modificado. O bloco é inserido no final, separado por 2 linhas em branco. Se o atleta apagar o bloco, a engine não reinsere.

---

## Variáveis de Ambiente

```env
DATABASE_URL=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_VERIFY_TOKEN=
STRAVA_REDIRECT_URI=
PROVIDER_STRAVA_ID=
PROVIDER_SECRET=
NEXT_PUBLIC_BASE_URL=
INTERNAL_BASE_URL=
INTERNAL_WORKER_SECRET=
```

---

## Desenvolvimento Local

```bash
npm install
npm run dev
```

Teste isolado do módulo Agenda:
```bash
node --env-file=.env.local scripts/testAgendaModule.js
```

> OAuth requer redirect URI público. Em localhost, atualize os tokens diretamente no banco após autenticação manual.

---

## Documentação

```
docs/
  architecture/
    strava-event-engine.md         ← visão geral, pipeline, rotas
    activity-processing-lifecycle.md
    strava-webhook-behavior.md
    database-schema.md
  decisions/
    ADR-001-activity-centered-processing.md
    ADR-002-roles-internos.md
    ADR-003-politica-descricao.md
    ADR-004-timezone.md
    ADR-005-agenda-daily.md
  modules/
    agenda.module.md
    engine-modules.md
```

---

## Status

| Componente | Status |
|---|---|
| OAuth + inscrição | ✅ Implementado |
| Backfill histórico | ✅ Implementado |
| Dashboard Agenda | ✅ Implementado (refinamento visual pendente) |
| Webhook handler | ✅ Implementado |
| Worker de processamento | 🔄 Em desenvolvimento |
| buildDescription + mergeDescription | ✅ Implementado |
| Deploy Vercel + registro webhook Strava | ⏳ Próximo passo |
