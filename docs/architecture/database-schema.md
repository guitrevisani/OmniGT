# Schema do Banco de Dados

Banco: Neon (PostgreSQL serverless)
Pool: `pg` via `src/lib/db.js`

---

## Tabelas

### `athletes`

Atletas autenticados via OAuth Strava.

| Coluna | Tipo | Descrição |
|---|---|---|
| `strava_id` | bigint PK | ID do atleta no Strava |
| `firstname` | text | |
| `lastname` | text | |
| `access_token` | text | Token atual |
| `refresh_token` | text | Token de refresh |
| `expires_at` | bigint | Unix timestamp de expiração |
| `granted_scopes` | text | Escopos concedidos pelo atleta |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `events`

Eventos criados na plataforma.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | serial PK | |
| `slug` | varchar UNIQUE | Identificador na URL |
| `name` | text | Nome exibido |
| `start_date` | date | |
| `end_date` | date | |
| `is_active` | boolean | |
| `access_mode` | text | `invite_only` (padrão) / `public` |
| `owner_strava_id` | bigint FK→athletes | |
| `module_id` | int FK→modules | |
| `required_scopes` | text | Padrão: `activity:read` |
| `updated_at` | timestamptz | |

**Eventos registrados:**
| id | slug | module_id | access_mode |
|---|---|---|---|
| 1 | `diario2026` | 1 (agenda) | invite_only |
| 2 | `estimator` | 3 (estimator) | public |

---

### `modules`

Módulos registrados na plataforma.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | serial PK | |
| `name` | text | Nome exibido |
| `slug` | varchar(100) UNIQUE | |
| `description` | text | |
| `is_active` | boolean | |
| `requires_registration` | boolean NOT NULL | Se true, exige login para acessar |
| `created_at` | timestamptz | |

**Módulos registrados:**
| id | slug | requires_registration |
|---|---|---|
| 1 | `agenda` | true |
| 3 | `estimator` | false |

---

### `athlete_events`

Vínculo atleta↔evento com role e status.

| Coluna | Tipo | Descrição |
|---|---|---|
| `strava_id` | bigint FK→athletes | |
| `event_id` | int FK→events | |
| `role` | text | `provider`, `owner`, `admin`, `user` |
| `status` | text | `active` (padrão) |
| `permissions` | jsonb | `{}` padrão |
| `joined_at` | timestamptz | |
| `created_at` | timestamptz | |

PK: `(strava_id, event_id)`

---

### `activities`

Atividades brutas do Strava. Populada pelo webhook (mínimo) e completada pelo worker.

| Coluna | Tipo | Descrição |
|---|---|---|
| `strava_activity_id` | bigint PK | |
| `strava_id` | bigint FK→athletes | |
| `start_date` | timestamp | UTC do Strava |
| `distance_m` | double precision | |
| `moving_time` | int | Segundos |
| `elapsed_time` | int | Segundos |
| `total_elevation_gain` | double precision | Metros |
| `commute` | boolean | |
| `gear_id` | text | |
| `device_name` | text | Dispositivo de captura (Garmin, Wahoo...) |
| `duplicate_of` | bigint FK→activities | Preenchido se atividade duplicada |
| `engine_last_put_at` | timestamptz | Último PUT da engine (loop guard) |
| `last_webhook_aspect` | text | Último aspect_type recebido |
| `last_webhook_at` | timestamptz | |
| `last_strava_update_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Nota sobre `duplicate_of`:** atividades registradas em múltiplos devices simultaneamente
são detectadas pelo worker e marcadas aqui. A atividade com maior `moving_time` é mantida
como original. Duplicatas são ignoradas no processamento.

---

### `event_activities`

Vínculo atividade↔evento. Uma linha por combinação — a mesma atividade pode pertencer
a múltiplos eventos.

| Coluna | Tipo | Descrição |
|---|---|---|
| `event_id` | int FK→events | |
| `strava_activity_id` | bigint FK→activities | |
| `processed` | boolean | false = pendente de processamento |
| `metadata` | jsonb | Estado por módulo: `{ "agenda": true }` |

PK: `(event_id, strava_activity_id)`

O campo `metadata` é atualizado pelo dispatcher conforme cada módulo processa a atividade.
`processed` é marcado `true` quando todos os módulos do evento foram processados.

---

### `activity_processing_queue`

Fila de processamento deduplicada por `strava_activity_id`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `strava_activity_id` | bigint PK | |
| `next_run_at` | timestamptz | Quando processar |
| `created_at` | timestamptz | |

---

### `strava_events`

Log de auditoria de todos os webhooks recebidos.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | bigserial PK | |
| `object_type` | text | |
| `aspect_type` | text | |
| `object_id` | bigint | |
| `owner_id` | bigint | |
| `payload` | jsonb | Payload completo |
| `processed` | boolean | |
| `created_at` | timestamptz | |
| `processed_at` | timestamptz | |

---

### `agenda_daily`

Consolidado diário por atleta/evento. Uma linha por `(event_id, strava_id, activity_date)`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | bigserial PK | |
| `event_id` | bigint FK→events | |
| `strava_id` | bigint FK→athletes | |
| `activity_date` | date | |
| `total_distance_m` | integer | |
| `total_elevation_gain_m` | integer | |
| `total_moving_time_sec` | integer | |
| `total_elapsed_time_sec` | integer | |
| `treino_distance_m` | integer | Atividades não-commute |
| `desloc_distance_m` | integer | Atividades commute |
| `treino_moving_time_sec` | integer | |
| `desloc_moving_time_sec` | integer | |
| `created_at` | timestamptz | |

UNIQUE: `(event_id, strava_id, activity_date)`

---

### `agenda_goals`

Metas do atleta no evento (módulo Agenda).

| Coluna | Tipo | Descrição |
|---|---|---|
| `event_id` | int FK→events | |
| `strava_id` | bigint FK→athletes | |
| `goal_distance_km` | numeric | |
| `goal_moving_time_sec` | integer | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

PK: `(event_id, strava_id)`

---

### `event_configs`

Configurações do evento (visuais + parâmetros por módulo).

| Coluna | Tipo | Descrição |
|---|---|---|
| `event_id` | int PK FK→events | |
| `color_primary` | text | |
| `color_secondary` | text | |
| `logo_url` | text | |
| `metadata` | jsonb | Parâmetros do módulo |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Exemplo de metadata para o módulo Estimator:**
```json
{
  "mass_kg": 85,
  "default_ftp_w": 260,
  "descent_kmh": 45,
  "cda": 0.32,
  "crr": 0.004
}
```

---

### `athlete_gears`

Equipamentos (bikes, tênis) do atleta. Populado pelo worker via `GET /gear/:id`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `gear_id` | text PK | ID do Strava (ex: `b12345`) |
| `strava_id` | bigint FK→athletes | |
| `name` | text | |
| `type` | text | `bike` ou `shoe` (inferido de `frame_type`) |
| `created_at` | timestamptz | |

**Inferência de tipo:** `frame_type` presente na resposta do Strava → `bike`; ausente → `shoe`.
O worker só chama `GET /gear/:id` para gears ainda não registrados no banco.

---

### `event_module_processing`

Rastreamento de processamento por módulo (granularidade fina para auditoria).

| Coluna | Tipo | Descrição |
|---|---|---|
| `event_id` | int | |
| `strava_activity_id` | bigint | |
| `module_id` | int | |
| `processed_at` | timestamptz | |
| `metadata` | jsonb | |

PK: `(event_id, strava_activity_id, module_id)`

---

## TO DO — Manutenção de Banco

- Remoção física de atividades com `last_webhook_aspect = 'delete'`
  (atualmente marcadas mas não removidas — decisão pendente de implementação)
