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

### `sessions`

Sessões ativas por atleta/evento. O cookie de sessão carrega o `token` (UUID),
nunca o `strava_id` diretamente.

| Coluna | Tipo | Descrição |
|---|---|---|
| `token` | text PK | UUID gerado no callback OAuth |
| `strava_id` | bigint FK→athletes | |
| `event_id` | int FK→events | |
| `expires_at` | timestamptz | Igual ao `end_date` do evento |
| `created_at` | timestamptz | |

Um atleta pode ter múltiplas sessões simultâneas (múltiplos devices ou eventos).
Sessões expiradas são ignoradas na validação mas não são removidas automaticamente.

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
| `push_heading` | text | Título da notificação push (opcional) |
| `push_body` | text | Corpo da notificação push (opcional) |
| `updated_at` | timestamptz | |

Se `push_heading` ou `push_body` forem nulos, o dispatcher usa textos padrão.

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

Vínculo atleta↔evento com role, status e preferências por evento.

| Coluna | Tipo | Descrição |
|---|---|---|
| `strava_id` | bigint FK→athletes | |
| `event_id` | int FK→events | |
| `role` | text | `provider`, `owner`, `admin`, `user` |
| `status` | text | `active` (padrão) |
| `permissions` | jsonb | `{}` padrão |
| `push_consent` | boolean | Consentimento para notificações push neste evento |
| `joined_at` | timestamptz | |
| `created_at` | timestamptz | |

PK: `(strava_id, event_id)`

`push_consent` é por evento — o atleta pode ativar notificações em um evento
e bloquear em outro. Atualizado a cada autenticação OAuth.

---

### `notification_devices`

Devices registrados para notificações push via OneSignal.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | bigserial PK | |
| `strava_id` | bigint FK→athletes | |
| `player_id` | text | ID do device no OneSignal |
| `platform` | text | `web`, `ios`, `android` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

UNIQUE: `(strava_id, player_id)`

Um atleta pode ter múltiplos devices registrados. O `player_id` é fornecido
pelo SDK do OneSignal após o atleta aceitar o prompt nativo do browser.

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
são detectadas pelo worker. A atividade com maior `moving_time` é mantida como original.

---

### `event_activities`

Vínculo atividade↔evento. Uma linha por combinação.

| Coluna | Tipo | Descrição |
|---|---|---|
| `event_id` | int FK→events | |
| `strava_activity_id` | bigint FK→activities | |
| `processed` | boolean | false = pendente de processamento |
| `metadata` | jsonb | Estado por módulo: `{ "agenda": true }` |

PK: `(event_id, strava_activity_id)`

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

Consolidado diário por atleta/evento.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | bigserial PK | |
| `event_id` | bigint FK→events | |
| `strava_id` | bigint FK→athletes | |
| `activity_date` | date | |
| `total_distance_m` | integer | |
| `total_elevation_gain_m` | integer | Metros |
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

---

### `athlete_gears`

Equipamentos do atleta. Populado pelo worker via `GET /gear/:id`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `gear_id` | text PK | ID do Strava (ex: `b12345`) |
| `strava_id` | bigint FK→athletes | |
| `name` | text | |
| `type` | text | `bike` ou `shoe` (inferido de `frame_type`) |
| `created_at` | timestamptz | |

---

### `event_module_processing`

Rastreamento de processamento por módulo.

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
- Limpeza periódica de sessões expiradas em `sessions`
