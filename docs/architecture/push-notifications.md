# Notificações Push

**Provedor:** OneSignal Web Push
**App ID:** `71f20180-4f8a-4486-88a9-1cd76da6215a`
**ADR:** `docs/decisions/ADR-009-push-consent.md`

---

## Arquitetura

```
OneSignalInit.jsx (global, no layout)
│  Inicializa SDK uma vez para toda a aplicação
│  notifyButton: { enable: false } — sem botão flutuante padrão
▼
AgendaDashboard.jsx
│  Ao carregar: verifica OneSignal.User.PushSubscription.optedIn
│  Se push_consent=true no banco E device não tem opt-in:
│    → chama optIn() automaticamente (dispara prompt nativo do browser)
│  Se já inscrito: aplica tag event_<slug> via addTags()
│  Listener onChange: ao aceitar prompt → registra device via /api/push/register
▼
/api/push/register
│  Salva (strava_id, player_id) em notification_devices
│  PUT /api/v1/players/:player_id no OneSignal
│    → tags: { strava_id: "...", event_<slug>: "true" }
▼
/api/internal/module-dispatcher
│  Após PUT bem-sucedido no Strava:
│  sendPushNotification(eventId, eventName)
│    → busca slug do evento
│    → POST /api/v1/notifications com filtro event_<slug>=true
```

---

## Segmentação por Tags

Toda segmentação é programática — sem criação de segmentos no painel do OneSignal.

| Tag | Valor | Uso |
|---|---|---|
| `strava_id` | `"23978606"` | Notificação individual (quando necessário) |
| `event_<slug>` | `"true"` | Notificação broadcast para todos inscritos no evento |

Para notificar um atleta individualmente:
```json
{ "field": "tag", "key": "strava_id", "relation": "=", "value": "23978606" }
```

Para notificar todos de um evento:
```json
{ "field": "tag", "key": "event_diario2026", "relation": "=", "value": "true" }
```

---

## Consentimento

O consentimento é por evento, salvo em `athlete_events.push_consent`.

Fluxo:
1. Atleta marca checkbox "ativar notificações" no `/register`
2. `push_consent=true` salvo em `athlete_events` via callback OAuth
3. No primeiro acesso ao dashboard, `optIn()` é chamado automaticamente
4. Browser exibe prompt nativo (obrigatório pelo browser — não pode ser substituído)
5. Ao aceitar: `player_id` registrado em `notification_devices` + tags aplicadas

O botão 🔔 no dashboard permite ativar/desativar manualmente a qualquer momento,
independentemente da escolha feita no registro.

---

## Templates de Push

Configuráveis por evento nas colunas `events.push_heading` e `events.push_body`.

| Campo | Fallback |
|---|---|
| `push_heading` | `"OGT Event Engine"` |
| `push_body` | `"Nova atividade processada e descrição atualizada."` |

---

## Service Worker

`public/OneSignalSDKWorker.js` — obrigatório para push em background (quando o browser está fechado).

```javascript
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
```

Deve estar na raiz do domínio (`/OneSignalSDKWorker.js`).

---

## Configuração OneSignal (painel)

- **Permission Prompt:** Native Prompt, sem auto-prompt — disparo programático via `optIn()`
- **Welcome Notification:** desabilitada (gerenciado pelo próprio OneSignal — desabilitar em Typical Site Settings)
- **Notify Button:** desabilitado (UI própria no dashboard)
- **Service Worker Path:** `/` (raiz do domínio)
- **Segmentação:** totalmente programática via tags, sem segmentos criados no painel

---

## Registro de Device — Timing

O `player_id` é reportado pelo SDK antes de o OneSignal processar o device no servidor.
Por isso, `/api/push/register` é chamado com 2 segundos de delay após o opt-in,
evitando que a aplicação de tags falhe por device ainda não existente na API.
