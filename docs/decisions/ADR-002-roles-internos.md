# ADR-002 — Roles Internos da Engine

**Status:** Accepted

---

## Contexto

O Strava é utilizado exclusivamente como provedor de identidade e fonte de dados de atividades. Controle de acesso precisa ser implementado pela engine.

## Decisão

Roles são definidos e gerenciados internamente, armazenados em `athlete_events.role`.

| Role | Descrição |
|---|---|
| `provider` | Proprietário da plataforma (IP holder). Acesso irrestrito. |
| `owner` | Criador e mantenedor do evento. |
| `admin` | Designado pelo owner. Acesso a configurações do evento. |
| `user` | Participante do evento. |

**Atribuição no callback OAuth:**
- `provider` → `strava_id === PROVIDER_STRAVA_ID`
- `owner` → `strava_id === event.owner_strava_id`
- `user` → todos os demais
- `admin` → atribuído manualmente, nunca via OAuth

**Regra de proteção:** roles superiores (`provider`, `owner`, `admin`) nunca são rebaixados por novo login. O `ON CONFLICT` do upsert preserva o role mais alto.

## Consequências

- Controle de acesso totalmente desacoplado do Strava
- Remoção de acesso a um evento não afeta a conta Strava do atleta
