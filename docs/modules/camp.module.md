# Módulo: Camp

**Slug:** `camp`
**Status:** Especificação prévia — não implementado
**requires_registration:** `true`
**REPROCESS_ON_DELETE:** `true` (presumido — a definir)

---

## Conceito

Camp é uma imersão de treinamento de curta duração, geralmente associada a uma viagem
planejada em torno do esporte. Diferente do Agenda (evento individual de longa duração),
o Camp é coletivo e intensivo — os participantes treinam juntos no mesmo período e local,
e o módulo documenta essa experiência coletiva via descrição das atividades.

---

## Diferenças em relação ao Agenda

| Dimensão | Agenda | Camp |
|---|---|---|
| Duração típica | Ano inteiro | 2–4 dias |
| Contexto | Individual | Coletivo |
| Datas | Ano fixo (padrão) | Definidas pelo owner, sem padrão |
| Dashboard | Sim (completo) | A definir — possivelmente inexistente |
| Metas | Distância + tempo (por atleta) | A definir |
| Interação social | Nenhuma | Prevista (formato a definir) |

---

## Tipos de Atividade

Configurável por evento. Valores possíveis:

| Tipo Strava | Descrição |
|---|---|
| `Ride` | Pedalada externa |
| `VirtualRide` | Pedalada indoor/virtual |
| `Run` | Corrida |
| `TrailRun` | Trail running |

O padrão para um novo evento Camp é ciclismo (`Ride` + `VirtualRide`).
O owner pode ampliar para incluir corrida no momento da criação do evento.
Configuração armazenada em `event_configs.metadata`.

---

## Bloco de Descrição — Rascunho

Campos previstos, sujeitos a revisão:

```
[Nome do Camp]
🚴🏼 142 km · ↑ 2840 m · ⏱ 5:22
IF 0.87 · NP 241W
Dia 2 de 4
```

| Campo | Fonte | Condição |
|---|---|---|
| Distância acumulada | `activities` / `camp_daily` | Sempre |
| Elevação acumulada | `activities` / `camp_daily` | Sempre |
| Tempo acumulado | `activities` / `camp_daily` | Sempre |
| IF estimado | Calculado (sem sensor) ou medido | Sempre — estimado se sem potência |
| NP (Normalized Power) | `activities` via Strava | Apenas se disponível |
| Dia N de M | Posição no período do evento | Sempre |
| Descrição da rota/treino | Campo livre por atividade ou evento | A definir — pode ser preenchido pelo owner |

**Nota sobre IF:** quando o atleta não tem sensor de potência, o IF pode ser estimado
a partir de velocidade + perfil de elevação, similar ao que o Estimator já faz.
Quando disponível na atividade Strava (`average_watts`), usa o valor medido.

---

## Interação Social

Prevista mas formato a definir. Possibilidades em discussão:

- Comentário automático na atividade com menção aos companheiros de treino
- Leaderboard diário simples (sem dashboard web)
- Nenhuma — apenas o bloco de descrição individual

Decisão adiada para segunda iteração do módulo.

---

## Dashboard

Possivelmente inexistente — o bloco de descrição na atividade do Strava
é a interface principal do atleta com o Camp.

Se implementado, seria um formato mais simples que o Agenda:
possivelmente uma página de leaderboard estático ou um resumo do grupo.

---

## Estrutura de Arquivos Prevista

```
src/engine/modules/camp/
  index.js            ← ACCEPTED_SPORT_TYPES (configurável), REPROCESS_ON_DELETE
  buildDescription.js ← gera o descriptionBlock
  computeTotals.js    ← calcula acumulados do atleta no período
```

Sem `computeDashboard.js` por enquanto.

---

## Dependências de Banco Previstas

### Novas tabelas (a criar)

**`camp_daily`** — consolidado diário por atleta/evento, similar ao `agenda_daily`.
Estrutura a definir na implementação.

### Tabelas existentes reutilizadas

- `events` — slug, start_date, end_date, module_id, push_heading, push_body
- `athlete_events` — role, status, push_consent
- `activities` — dados brutos (distance_m, total_elevation_gain, moving_time, average_watts)
- `event_activities` — vínculo atividade↔evento, fila de processamento
- `event_configs.metadata` — sport_types aceitos para o evento

---

## Pendências para Implementação

1. Definir formato final do bloco de descrição
2. Decidir sobre interação social (e formato)
3. Decidir sobre dashboard (ou confirmar ausência)
4. Definir schema de `camp_daily`
5. Definir método de estimativa de IF sem sensor de potência
6. Criar ADR para sport_types configuráveis por evento (impacta outros módulos futuros)
7. Registrar módulo no banco (`modules` table, id a definir)
8. Registrar módulo no `MODULE_REGISTRY` do dispatcher
