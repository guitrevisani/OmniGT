# Strava Webhook Behavior

Descreve o comportamento dos webhooks do Strava e como a engine os processa.

---

## Eventos Recebidos

| Evento | Descrição |
|---|---|
| `activity.create` | Nova atividade registrada |
| `activity.update` | Atividade editada pelo atleta |
| `activity.delete` | Atividade removida |

---

## Payload

O webhook **não contém os dados completos da atividade**. Contém apenas:

```json
{
  "object_type": "activity",
  "object_id":   123456789,
  "aspect_type": "create",
  "owner_id":    23978606,
  "event_time":  1234567890
}
```

Por isso o worker sempre executa `GET /activities/:id` para obter o estado atual completo.

---

## Responsabilidade do Handler

O webhook tem **uma única responsabilidade: registrar e enfileirar.**

1. Grava payload completo em `strava_events` (auditoria)
2. UPSERT em `activities` — garante que o worker sempre encontra o registro com `strava_id`
3. Aplica loop guard (ignora se engine fez PUT há < 120s)
4. Enfileira em `activity_processing_queue`
5. Dispara worker (fire-and-forget)

O handler não executa lógica de módulo, não consulta eventos, não toma decisões de processamento.

---

## Coalescência de Eventos

Múltiplos webhooks para a mesma atividade são coalescidos pela fila:

```
activity.create   →  INSERT queue (next_run_at = now + 300s)
activity.update   →  UPDATE queue (next_run_at = now + 300s)
activity.update   →  UPDATE queue (next_run_at = now + 300s)
                       ↓
              1 único processamento após 300s
```

DELETE não recebe delay — entra na fila com `next_run_at = now`.

---

## Proteção contra Loop

A engine faz PUT na descrição da atividade, o que gera um webhook `update`.

**Solução em dois níveis:**
1. **Webhook:** checa `engine_last_put_at`. Se < 120s, descarta antes de enfileirar
2. **Módulo:** `description` nunca é campo sensível — mesmo que o webhook passe, o dispatcher não gera novo bloco se os dados não mudaram

---

## Registro do Webhook no Strava

Requer endpoint público HTTPS — só pode ser registrado após deploy em produção.

Variável necessária: `STRAVA_VERIFY_TOKEN`

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<STRAVA_CLIENT_ID> \
  -F client_secret=<STRAVA_CLIENT_SECRET> \
  -F callback_url=https://<dominio>/api/stravaWebhook \
  -F verify_token=<STRAVA_VERIFY_TOKEN>
```

Para verificar o webhook registrado:
```bash
curl -G https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=<STRAVA_CLIENT_ID> \
  -d client_secret=<STRAVA_CLIENT_SECRET>
```
