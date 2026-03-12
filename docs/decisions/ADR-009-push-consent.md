# ADR-009 — Consentimento Push por Evento

**Status:** Aceito
**Data:** 2026-03

---

## Contexto

Notificações push são opt-in por natureza (browser exige permissão explícita).
A plataforma precisa respeitar a escolha do atleta por evento — um atleta pode
participar de múltiplos eventos com preferências distintas de notificação.

---

## Decisão

O consentimento para notificações push é armazenado por evento em `athlete_events.push_consent`.
A segmentação no OneSignal usa tags (`event_<slug> = true`) em vez de segmentos estáticos.

O fluxo é:
1. Atleta escolhe no formulário de inscrição (`/register`)
2. `push_consent` salvo no callback OAuth
3. Dashboard lê `push_consent` e dispara `optIn()` automaticamente se necessário
4. Device registrado em `notification_devices` com tags `strava_id` e `event_<slug>`
5. Dispatcher filtra por tag `event_<slug>` ao disparar notificações

---

## Consequências

**Positivas:**
- Granularidade por evento — atleta controla notificações evento a evento
- Segmentação programática — sem dependência de segmentos manuais no painel
- Tag `strava_id` permite notificações individuais quando necessário
- Opt-in automático no dashboard elimina fricção após o formulário

**Negativas:**
- Player_id registrado por device, não por atleta — um atleta com 3 devices
  gera 3 registros em `notification_devices`
- Sem deduplicação automática se o atleta aceitar o prompt em múltiplos browsers

**Futuro:**
- Remoção de device ao fazer logout (opcional — melhoria de higiene)
- Interface para o atleta gerenciar devices registrados
