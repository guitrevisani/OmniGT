# Módulo: Camp

**Slug:** `camp`
**Status:** Especificação — não implementado
**requires_registration:** `true`
**REPROCESS_ON_DELETE:** `true`

---

## Conceito

Camp é uma imersão de treinamento de curta duração (2–15 dias, padrão 2–4),
coletiva e intensiva. Os participantes treinam em grupo no mesmo período e local.
O módulo documenta a experiência via bloco de descrição nas atividades, dashboard
individual e dashboard analítico para o owner.

---

## Diferenças em relação ao Agenda

| Dimensão | Agenda | Camp |
|---|---|---|
| Duração típica | Ano inteiro | 2–15 dias |
| Contexto | Individual | Coletivo |
| Sessões | Livre | Pré-definidas pelo owner |
| Dashboard | Individual | Individual + owner analítico |
| Metas | Distância + tempo | Por sessão (opcional) |
| Acesso | Invite only | Invite only (obrigatório) |
| Formulário | Não | Sim (inscrição com dados pessoais) |
| Consolidação | `agenda_daily` | Direto de `activities` (volume pequeno) |

---

## Roles

| Role | Descrição |
|---|---|
| `provider` | Escopo de plataforma — não específico do camp |
| `owner` | Cria e configura o camp, acesso ao dashboard analítico |
| `admin` | Co-gerencia um camp específico — mesmo acesso que owner, sem criação |
| `athlete` | Inscrito via convite, acesso ao dashboard individual |

---

## Tipos de Atividade

Configurável por evento via `event_configs.metadata.accepted_sport_types`.
Campo obrigatório na criação do evento. Sem fallback hardcoded.

Valores suportados: `Ride`, `VirtualRide`, `MountainBikeRide`, `GravelRide`,
`Run`, `TrailRun`, `Workout` e variações reconhecidas pelo Strava.

O dispatcher lerá `accepted_sport_types` de `event_configs.metadata` em vez de
`ACCEPTED_SPORT_TYPES` hardcoded — impacta todos os módulos (ver ADR-010).

---

## Timezone e Datas

Todas as timestamps no banco são armazenadas em UTC (`timestamp without time zone`,
padrão do banco configurado como GMT).

O campo `start_date_local` do Strava determina o horário local onde a atividade foi
registrada — é a referência para determinar o dia e a proximidade com `scheduled_start`
das sessões. Não há campo de timezone na configuração do evento.

---

## Sessões

Sessões são unidades de treino pré-definidas pelo owner na configuração do evento.
Não se confundem com deduplicação de atividades por múltiplos devices — essa lógica
permanece no worker via `duplicate_of` em `activities`.

### Propriedades de uma sessão

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | serial PK | |
| `event_id` | int FK→events | |
| `day_number` | int | Dia do camp (1, 2, 3...) |
| `session_order` | int | Ordem no dia (1 = manhã, 2 = tarde...) |
| `name` | text | Ex: "Etapa 1 — Subida ao Pico" |
| `short_description` | text | Descrição sintética exibida no bloco (definida pelo owner) |
| `description` | text | Descrição completa para os atletas |
| `activity_type` | text | Tipo Strava esperado |
| `strava_route_id` | bigint | ID da rota no Strava (critério primário de match) |

| `scheduled_start` | time | Horário previsto de largada (horário local — referência para match) |
| `objective` | text | Objetivo da sessão (opcional) |
| `is_optional` | boolean | Default false |
| `created_at` | timestamp | UTC |

### Match atividade → sessão

O match determina a qual sessão pré-definida pertence uma atividade do atleta.
É independente da deduplicação por múltiplos devices (já resolvida pelo worker).
O worker garante no máximo uma atividade por atleta — não há ambiguidade de candidatos.

Critérios em ordem de prioridade:

1. **Rota** — `strava_route_id` comparado com `activity.route_id` quando disponível no Strava
2. **Data + horário** — `start_date_local::date` corresponde ao dia da sessão + proximidade com `scheduled_start`
3. **Validação cruzada** — atividades de outros atletas do grupo no mesmo horário reforçam o match

Prazo de match: até 23:59 (horário local da atividade via `start_date_local`) do dia
seguinte ao encerramento do evento. Após esse prazo, sessões sem match são marcadas
como `not_completed` (obrigatórias) ou `skipped` (opcionais).

### Tabela: `camp_session_activities`

Vínculo atividade → sessão após match. Um atleta, uma atividade por sessão.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | serial PK | |
| `session_id` | int FK→camp_sessions | |
| `strava_activity_id` | bigint FK→activities | |
| `strava_id` | bigint FK→athletes | |
| `match_method` | text | `route` \| `datetime` \| `crossvalidation` |
| `start_date_local` | timestamp | Horário local da atividade fornecido pelo Strava |
| `matched_at` | timestamp | UTC |

UNIQUE: `(session_id, strava_id)`

---

## Métricas

### Acumulados — escopo

Todas as métricas são calculadas **por atividade**, somando as atividades do atleta
no camp com `start_date <= start_date da atividade atual` (retroativamente ignorante —
mesmo padrão do Agenda). Não há agregado por dia.

| Métrica | Escopo | Fonte |
|---|---|---|
| Distância | atividade atual + camp até aqui | `activities.distance_m` |
| Elevação | atividade atual + camp até aqui | `activities.total_elevation_gain` |
| Tempo em movimento | atividade atual + camp até aqui | `activities.moving_time` |
| NP | atividade atual | `activities.weighted_average_watts` ou estimado |
| IF | atividade atual | NP / FTP |
| Métricas de carga | atividade atual + camp até aqui | calculado |

### NP e IF — sempre presentes

NP e IF estão sempre presentes no bloco. Sempre haverá algum valor de potência
e FTP, ainda que atribuídos por estimativa.

```
NP:
  SE weighted_average_watts IS NOT NULL → NP medido
  SENÃO → NP estimado via física (velocidade + elevação + massa + CdA/Crr)
          tag "(estimado)" no bloco

FTP:
  1. camp_athlete_profiles.ftp_w (formulário de inscrição)
  2. Zonas de potência do Strava, se disponíveis
  3. Estimativa a partir da FC máx (camp_athlete_profiles.hr_max e hr_zones)
  4. Estimativa epidemiológica hardcoded por perfil de atleta (gênero + idade)
  tag "(estimado)" quando obtido por FC ou epidemiológico

IF = NP / FTP
```

`average_watts` não é usado para cálculo de IF ou NP — não é métrica aplicável.

### Métricas de carga (CTL, ATL, TSB)

Calculadas somente com as atividades do período do camp — sem histórico externo.
Representam o **impacto do camp**, não o estado de forma absoluto do atleta.
Rotuladas explicitamente como "impacto do camp" no dashboard.

### Zonas de FC

Retornadas pelo Strava por atividade quando disponíveis (`zones` endpoint).
Referência: `camp_athlete_profiles.hr_zones` — 5 valores `[z1_max, z2_max, z3_max, z4_max, hr_max]`
em bpm; Z5 é desmembrada pelo código em Z5a, Z5b, Z5c a partir de `hr_max`.

---

## Bloco de Descrição

O bloco segue o padrão de início `[Nome do Camp]` de todos os módulos.

```
[Nome do Camp]
Sessão 1.2 · Descrição sintética da sessão
🚴🏼  89 km · 231 km camp
↑  1.420 m · 3.840 m camp
⏱  3:14 · 8:22 camp
IF 0.87 · NP 241W
[métricas de carga aplicáveis]
```

NP estimado via física:
```
IF 0.87 · NP 241W (estimado)
```

FTP estimado por FC ou epidemiológico:
```
IF 0.87 (estimado) · NP 241W
```

Ambos estimados:
```
IF 0.87 (estimado) · NP 241W (estimado)
```

### Campos do bloco

| Linha | Conteúdo | Condição |
|---|---|---|
| 1 | `[Nome do Camp]` | Sempre |
| 2 | `Sessão d.s · short_description` | Sempre |
| 3 | Distância atividade · distância camp | Sempre |
| 4 | Elevação atividade · elevação camp | Sempre |
| 5 | Tempo atividade · tempo camp | Sempre |
| 6 | IF · NP (com tag `(estimado)` quando aplicável) | Sempre |
| 7+ | Métricas de carga aplicáveis | Quando disponíveis |

---

## Formulário de Inscrição

Exibido após autenticação OAuth, antes de confirmar a inscrição.

### Campos

**Métricas de referência (opcionais individualmente):**
- FTP (watts)
- Peso (kg)
- FC máx (bpm)
- Zonas de FC — 5 valores em bpm `[z1_max, z2_max, z3_max, z4_max, hr_max]`
  (Z5 calculada pelo código a partir de `hr_max`)

**Dados pessoais:**
- Data de nascimento
- Gênero (`masculino` | `feminino`) — necessário para estimativas de carga

**Contato:**
- Email
- WhatsApp

**Emergência:**
- Nome do contato
- Telefone do contato
- Checkbox obrigatório (default false): declaração de ter consultado e obtido laudo
  médico autorizando a prática de atividades físicas intensas e de longa duração

**Consentimento:**
- Termo de participação (versão versionada)
- Checkbox de aceite + timestamp UTC + IP

### Tabela: `camp_athlete_profiles`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | serial PK | |
| `event_id` | int FK→events | |
| `strava_id` | bigint FK→athletes | |
| `ftp_w` | int | FTP em watts (opcional) |
| `weight_kg` | numeric | Peso em kg (opcional) |
| `hr_max` | int | FC máx em bpm (opcional) |
| `hr_zones` | jsonb | `[z1_max, z2_max, z3_max, z4_max, hr_max]` em bpm (opcional) |
| `gender` | text | `masculino` \| `feminino` |
| `birth_date` | date | |
| `email` | text | |
| `whatsapp` | text | |
| `emergency_name` | text | |
| `emergency_phone` | text | |
| `medical_clearance` | boolean NOT NULL DEFAULT false | Declaração de laudo médico |
| `consent_version` | text NOT NULL | Versão do termo aceito |
| `consent_at` | timestamp NOT NULL | UTC |
| `consent_ip` | text NOT NULL | |
| `created_at` | timestamp | UTC |
| `updated_at` | timestamp | UTC |

UNIQUE: `(event_id, strava_id)`

---

## Dashboard Individual (atleta)

- Progresso por sessão (realizada / não realizada / opcional)
- Acumulados do camp (distância, elevação, tempo)
- Métricas de carga do camp (impacto)
- Alguns indicadores do grupo (média do grupo, participação)
- Exportável como imagem (mesmo mecanismo do Estimator)

## Dashboard Owner/Admin

- Visão analítica do grupo por sessão
- Participação e completion rate por sessão
- Métricas agregadas do grupo
- Exportável como imagem

---

## Configuração do Evento (`event_configs.metadata`)

```json
{
  "accepted_sport_types": ["Ride", "VirtualRide"],
  "location": "Serra da Mantiqueira, SP",
  "objective": "Descrição geral do camp",
  "max_days": 4
}
```

Parâmetros físicos (`cda`, `crr`, `mass_kg`) são hardcoded na engine — não configuráveis
pelo owner. FTP e demais métricas de referência são individuais, obtidos do formulário
de inscrição ou estimados pela engine.

---

## Estrutura de Arquivos

```
src/engine/modules/camp/
  index.js            ← REPROCESS_ON_DELETE, sem ACCEPTED_SPORT_TYPES (vem do banco)
  buildDescription.js ← gera o descriptionBlock
  computeTotals.js    ← agrega acumulados do camp até a atividade atual
  estimateNP.js       ← estima NP via física (velocidade + elevação + massa + CdA/Crr)
  estimateFTP.js      ← estima FTP via FC máx e via epidemiológico (gênero + idade)
  matchSession.js     ← match atividade → sessão pré-definida
```

---

## Novas Tabelas Necessárias

```sql
-- Sessões pré-definidas do camp
CREATE TABLE camp_sessions (
  id                serial PRIMARY KEY,
  event_id          int NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  day_number        int NOT NULL,
  session_order     int NOT NULL DEFAULT 1,
  name              text NOT NULL,
  short_description text,
  description       text,
  activity_type     text NOT NULL,
  strava_route_id   bigint,
  scheduled_start   time,
  objective         text,
  is_optional       boolean NOT NULL DEFAULT false,
  created_at        timestamp DEFAULT now()
);

-- Match atividade → sessão
CREATE TABLE camp_session_activities (
  id                   serial PRIMARY KEY,
  session_id           int NOT NULL REFERENCES camp_sessions(id) ON DELETE CASCADE,
  strava_activity_id   bigint NOT NULL REFERENCES activities(strava_activity_id),
  strava_id            bigint NOT NULL REFERENCES athletes(strava_id),
  match_method         text NOT NULL,
  start_date_local     timestamp,
  matched_at           timestamp DEFAULT now(),
  UNIQUE (session_id, strava_id)
);

-- Perfil do atleta no camp (formulário de inscrição)
CREATE TABLE camp_athlete_profiles (
  id                serial PRIMARY KEY,
  event_id          int NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  strava_id         bigint NOT NULL REFERENCES athletes(strava_id),
  ftp_w             int,
  weight_kg         numeric,
  hr_max            int,
  hr_zones          jsonb,
  gender            text,
  birth_date        date,
  email             text,
  whatsapp          text,
  emergency_name    text,
  emergency_phone   text,
  medical_clearance boolean NOT NULL DEFAULT false,
  consent_version   text NOT NULL,
  consent_at        timestamp NOT NULL,
  consent_ip        text NOT NULL,
  created_at        timestamp DEFAULT now(),
  updated_at        timestamp DEFAULT now(),
  UNIQUE (event_id, strava_id)
);
```

---

## Dependências de Schema Existente

Colunas já presentes em `activities` utilizadas pelo módulo:
- `weighted_average_watts` ✓ — NP medido
- `device_watts` ✓ — indica se watts são de sensor ou estimados pelo Strava
- `start_date_local` ✓ — adicionado em 2026-03-15
- `average_watts` — presente mas **não utilizado** para IF/NP

---

## Pendências para Implementação

1. **ADR-010** — `accepted_sport_types` configuráveis por evento via `event_configs.metadata` — impacta dispatcher e todos os módulos
2. Adaptar dispatcher para ler `accepted_sport_types` do banco
3. Implementar `matchSession.js`
4. Implementar `estimateNP.js` reaproveitando física do Estimator
5. Implementar `estimateFTP.js` (via FC máx e via epidemiológico com gênero + idade)
6. Implementar `computeTotals.js` e `buildDescription.js`
7. Criar rotas de API para formulário de inscrição
8. Criar rotas de API para configuração de sessões (owner)
9. Implementar dashboards individual e owner (ambos exportáveis como imagem)
10. Registrar módulo `camp` na tabela `modules`
11. Registrar no `MODULE_REGISTRY` do dispatcher
12. Definir interação social (segunda iteração)
