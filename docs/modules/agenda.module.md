# Módulo: Agenda de Treinos

**Localização:** `src/engine/modules/agenda/`
**Slug:** `agenda`
**ID no banco:** `1`
**requires_registration:** `true`
**REPROCESS_ON_DELETE:** `true`

---

## Objetivo

Consolidar atividades de ciclismo de um atleta dentro do período de um evento, gerando:

1. Bloco de texto para inserção na descrição de atividades do Strava
2. Dados diários agregados para o dashboard web
3. Totais do período

---

## Tipos de Atividade Aceitos

| Tipo Strava | Descrição |
|---|---|
| `Ride` | Pedalada externa |
| `VirtualRide` | Pedalada indoor/virtual |
| `HandCycle` | Handbike |
| `Velomobile` | Velomóvel |

---

## Estrutura de Arquivos

```
src/engine/modules/agenda/
  index.js            ← constantes (ACCEPTED_SPORT_TYPES, REPROCESS_ON_DELETE)
  buildDescription.js ← gera o descriptionBlock
  computeDashboard.js ← agrega dados para o dashboard
  computeTotals.js    ← calcula totais do período
```

---

## Critério de Dia Ativo

```
total_moving_time_sec >= 900  (15 minutos)
```

---

## buildDescription — Formato de Saída

```
[Nome do Evento]
🚴🏼 4354/22000
⏱️ 179:08
🗓️ 59 dias ativos
```

| Campo | Regra |
|---|---|
| `🚴🏼 km/meta` | km inteiros, cresce ad infinitum além da meta |
| `⏱️ HH:MM` | Regressivo até a meta. Após atingir: `+HH:MM` |
| `🗓️ N dias ativos` | Singular quando `activeDays === 1` |

### Exemplos de tempo

| Total acumulado | Meta | Exibe |
|---|---|---|
| 720h | 900h | `⏱️ 180:00` |
| 895h | 900h | `⏱️ 5:00` |
| 900h | 900h | `⏱️ +0:00` |
| 912h30m | 900h | `⏱️ +12:30` |

---

## computeTotals — Saída

```javascript
{
  totalDistanceM:     number,
  totalMovingTimeSec: number,
  totalElevationM:    number,
  activeDays:         number,
  goalDistanceKm:     number,   // de agenda_goals
  goalMovingTimeSec:  number,   // de agenda_goals
}
```

---

## Formatação no Dashboard

| Contexto | Função | Formato |
|---|---|---|
| Recordes de distância | `fmtKm(m)` | 1 casa decimal (`4354.2 km`) |
| Demais totais de distância | `fmtKmInt(m)` | Inteiro (`4354 km`) |
| Elevação | direto em metros | Inteiro (`1840 m`) |
| Tempo | `HH:MM` | Sem segundos |

---

## Fluxo de Inscrição

```
/[slug]/register
│  Formulário:
│    ☐ Manter metas atuais (keep_goals) — marcado por padrão
│    ☐ Consentimento Strava — obrigatório
│    ☐ Ativar notificações — opcional, desmarcado por padrão
│
│  Se keep_goals=0 → campos de meta habilitados (obrigatórios)
│
▼
/api/auth/strava/start
  params: event, keep_goals, goal_km, goal_hours, push_consent
▼
/api/auth/strava/callback
  → UPSERT athlete_events (push_consent)
  → keep_goals=1 + metas existem → mantém agenda_goals
  → keep_goals=0 → UPSERT agenda_goals com novos valores
  → keep_goals=1 + sem metas → ?warn=no_goals (banner âmbar, keepGoals desmarcado)
  → createSession + backfill
```

---

## Dashboard — Seções

| Seção | Descrição |
|---|---|
| Header | Nome do evento, datas, número do dia no ano |
| Progresso | Barras de distância e tempo em relação à meta |
| Heatmap | Calendário de atividade por dia |
| Totais | Distância, tempo, elevação, dias ativos |
| Recordes | Melhor dia de distância e tempo |
| Últimas atividades | Lista das atividades recentes |

**Botões no header:**
- ↺ Sincronizar — dispara `POST /api/agenda/sync` (backfill manual)
- 🔔 Notificações — ativa/desativa push para o device atual

**Footer:** "sair deste dispositivo" → `POST /api/auth/strava/logout`

---

## Dependências de Banco

### Leitura (dispatcher)
- `agenda_daily` — dados consolidados por dia
- `agenda_goals` — metas do atleta no evento (LEFT JOIN)

### Escrita (backfill / sync)
- `activities` — atividades brutas
- `event_activities` — vínculo atividade↔evento
- `agenda_daily` — consolidado diário (UPSERT idempotente)

---

## Backfill e Sync

**Backfill** — disparado automaticamente no callback OAuth.
**Sync** — disparado manualmente pelo atleta no dashboard.

Ambos processam histórico desde `event.start_date` via `GET /athlete/activities`,
paginados (200/página, até 10 páginas, 1s delay).
Não fazem PUT no Strava. Idempotentes.
