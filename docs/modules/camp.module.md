# Módulo: Camp

**Slug:** `camp`
**Status:** Especificação prévia — não implementado
**requires_registration:** `true`
**REPROCESS_ON_DELETE:** `true`

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
| Dashboard | Sim (completo) | Não previsto |
| Metas | Distância + tempo (por atleta) | Não aplicável |
| Interação social | Nenhuma | Prevista (formato a definir) |
| Consolidação diária | `agenda_daily` | Direto de `activities` |

---

## Tipos de Atividade

Configurável por evento via `event_configs.metadata.accepted_sport_types`.
Sem fallback hardcoded — o campo é obrigatório na criação do evento.

Valores possíveis:

| Tipo Strava | Descrição |
|---|---|
| `Ride` | Pedalada externa |
| `VirtualRide` | Pedalada indoor/virtual |
| `Run` | Corrida |
| `TrailRun` | Trail running |

O padrão sugerido na criação de um novo evento Camp é `["Ride", "VirtualRide"]`.

**Impacto arquitetural:** o dispatcher precisará ler `accepted_sport_types` de
`event_configs.metadata` em vez de `ACCEPTED_SPORT_TYPES` hardcoded em `index.js`.
Ver ADR-010 (a criar).

---

## Bloco de Descrição

Dois acumulados independentes por linha: **do dia** e **do camp**.
Na primeira atividade do dia 1, os valores coincidem.

```
[Nome do Camp] · Dia 2 de 4
🚴🏼  89 km hoje · 231 km camp
↑  1420 m hoje · 3840 m camp
⏱  3:14 hoje · 8:22 camp
IF 0.87 · NP 241W
```

Sem sensor de potência:
```
IF 0.87 est.
```

### Campos

| Campo | Escopo | Fonte | Condição |
|---|---|---|---|
| Dia N de M | — | `event.start_date`, `event.end_date` | Sempre |
| Distância do dia | dia | `activities` agregado | Sempre |
| Distância do camp | camp | `activities` agregado | Sempre |
| Elevação do dia | dia | `activities` agregado | Sempre |
| Elevação do camp | camp | `activities` agregado | Sempre |
| Tempo do dia | dia | `activities` agregado | Sempre |
| Tempo do camp | camp | `activities` agregado | Sempre |
| IF | atividade atual | medido ou estimado | Sempre |
| NP | atividade atual | `weighted_average_watts` do Strava | Só se disponível |

### IF — lógica de fonte

```
SE activities.average_watts IS NOT NULL
  → IF = average_watts / FTP  (medido)
  → NP = weighted_average_watts (se disponível)
  → exibe: "IF 0.87 · NP 241W"

SENÃO
  → IF estimado via física (velocidade + elevação + massa + CdA/Crr)
  → exibe: "IF 0.87 est."
  → NP omitido
```

O FTP vem de `event_configs.metadata.default_ftp_w`.
Os parâmetros físicos (`mass_kg`, `cda`, `crr`) reutilizam os de `event_configs.metadata`,
os mesmos já usados pelo Estimator.

### Acumulados — fonte

Calculados diretamente de `activities` a cada processamento, sem tabela de consolidação.
Volume pequeno (2–4 dias) torna a agregação on-the-fly viável e sem overhead.

---

## Interação Social

Prevista mas formato a definir. Decisão adiada para segunda iteração.

Possibilidades em discussão:
- Comentário automático na atividade com menção aos companheiros de treino
- Leaderboard diário simples (página estática)
- Nenhuma — apenas o bloco de descrição individual

---

## Dashboard

Não previsto na primeira iteração. O bloco de descrição na atividade do Strava
é a interface principal do atleta com o Camp.

---

## Estrutura de Arquivos Prevista

```
src/engine/modules/camp/
  index.js            ← REPROCESS_ON_DELETE (sem ACCEPTED_SPORT_TYPES — vem do banco)
  buildDescription.js ← gera o descriptionBlock
  computeTotals.js    ← agrega acumulados de dia e camp direto de activities
  estimateIF.js       ← estima IF a partir de velocidade + elevação (sem sensor)
```

---

## Dependências de Banco

### Sem novas tabelas

- `events` — slug, start_date, end_date, module_id, push_heading, push_body
- `athlete_events` — role, status, push_consent
- `activities` — distance_m, total_elevation_gain, moving_time, average_watts, weighted_average_watts, start_date
- `event_activities` — vínculo atividade↔evento
- `event_configs.metadata` — accepted_sport_types, default_ftp_w, mass_kg, cda, crr

### Campos a verificar em `activities`

- `average_watts` — potência média (null se sem sensor)
- `weighted_average_watts` — Normalized Power (null se sem sensor)

Se não existirem, adicionar ao schema e ao UPSERT do worker.

---

## Pendências para Implementação

1. **ADR-010** — sport_types configuráveis por evento via `event_configs.metadata`
2. Verificar se `average_watts` e `weighted_average_watts` existem em `activities`
3. Adaptar dispatcher para ler `accepted_sport_types` do banco (impacta todos os módulos)
4. Implementar `estimateIF.js` reaproveitando física do Estimator
5. Definir formato final do bloco de descrição
6. Registrar módulo no banco (`modules` table)
7. Registrar no `MODULE_REGISTRY` do dispatcher
8. Definir interação social (segunda iteração)
