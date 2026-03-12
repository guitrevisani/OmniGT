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
  index.js            ← constantes (ACCEPTED_SPORT_TYPES, REPROCESS_ON_DELETE, isRegistration)
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

## Dependências de Banco

### Leitura (dispatcher)
- `agenda_daily` — dados consolidados por dia
- `agenda_goals` — metas do atleta no evento (via LEFT JOIN)

### Escrita (backfill)
- `activities` — atividades brutas
- `event_activities` — vínculo atividade↔evento
- `agenda_daily` — consolidado diário (UPSERT idempotente)

---

## Backfill

Disparado pelo callback OAuth somente para o módulo `agenda`.
Processa histórico de atividades desde `event.start_date` sem fazer PUT no Strava.
Idempotente — pode ser re-executado sem efeitos colaterais.
