# Operações e Infraestrutura

Referência operacional da plataforma OGT — variáveis de ambiente, serviços externos,
procedimentos de manutenção e diagnóstico.

---

## Variáveis de Ambiente (Vercel)

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string Neon (PostgreSQL serverless) |
| `STRAVA_CLIENT_ID` | Client ID do app Strava |
| `STRAVA_CLIENT_SECRET` | Client Secret do app Strava |
| `STRAVA_VERIFY_TOKEN` | Token de verificação do webhook Strava |
| `INTERNAL_WORKER_SECRET` | Bearer token para rotas `/api/internal/*` |
| `CRON_SECRET` | Bearer token para a rota `/api/cron/worker` |
| `PROVIDER_STRAVA_ID` | `strava_id` do provider (role máximo) |
| `INTERNAL_BASE_URL` | URL base interna (ex: `https://ogt.treine.com.gt`) |
| `NEXT_PUBLIC_BASE_URL` | URL base pública (fallback do `INTERNAL_BASE_URL`) |
| `ONESIGNAL_APP_ID` | App ID do OneSignal (server-side) |
| `ONESIGNAL_API_KEY` | REST API Key do OneSignal |
| `NEXT_PUBLIC_ONESIGNAL_APP_ID` | App ID do OneSignal (client-side) |
| `NEXT_PUBLIC_ONESIGNAL_SAFARI_WEB_ID` | Safari Web ID do OneSignal (opcional) |

---

## Serviços Externos

### Strava API
- **OAuth:** `https://www.strava.com/oauth/token`
- **Webhook:** registrado em `https://www.strava.com/api/v3/push_subscriptions`
- **Endpoint de recebimento:** `https://ogt.treine.com.gt/api/stravaWebhook`
- **Verify token:** valor de `STRAVA_VERIFY_TOKEN`
- **Escopo mínimo:** `activity:read` (padrão); `activity:write` necessário para PUT na descrição

### Neon (PostgreSQL)
- Banco serverless — connection string em `DATABASE_URL`
- Pool gerenciado pelo `pg` em `src/lib/db.js`
- SSL habilitado com `rejectUnauthorized: false`

### OneSignal (Web Push)
- Plataforma de notificações push
- Segmentação por tags: `event_<slug>` e `strava_id`
- Registro de devices: `POST /api/push/register` (requer sessão ativa)
- Disparo: feito pelo `module-dispatcher` após cada PUT bem-sucedido no Strava

### Vercel (Deploy)
- Plano: Hobby
- Deploy automático via Git
- Cron nativo **não utilizado** — substituído pelo cron-job.org
- `vercel.json` mantido vazio (`{}`)

---

## Cron — cron-job.org

O processamento da fila de atividades é disparado externamente pelo cron-job.org.

| Campo | Valor |
|---|---|
| URL | `https://ogt.treine.com.gt/api/cron/worker` |
| Método | `GET` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Intervalo | A cada 5 minutos |
| Timeout | 30s |
| Falha | Notificação por email habilitada |

**Por que não usar o cron da Vercel:**
O plano Hobby permite no máximo 1 execução por dia por cron job. Com atividades
podendo chegar a qualquer hora do dia, isso é insuficiente para garantir processamento
dentro de um tempo razoável.

**Latência máxima esperada:**
300s (delay de estabilização) + até 5min (próximo tick do cron) = ~10 minutos
entre o cadastro da atividade no Strava e a atualização da descrição.

**Endpoint protegido por:**
```
Authorization: Bearer <CRON_SECRET>
```
A Vercel injeta este header automaticamente se o cron nativo for reativado no futuro.
Chamadas externas devem incluir o header manualmente.

---

## Procedimentos de Manutenção

### Verificar fila de processamento
```sql
SELECT strava_activity_id, next_run_at,
       next_run_at <= NOW() AS pronta
FROM activity_processing_queue
ORDER BY next_run_at;
```

### Forçar reprocessamento de uma atividade
```sql
INSERT INTO activity_processing_queue (strava_activity_id, next_run_at)
VALUES (<activity_id>, NOW())
ON CONFLICT (strava_activity_id) DO UPDATE SET next_run_at = NOW();
```

### Verificar status de push de um atleta
```sql
SELECT ae.strava_id, ae.push_consent,
       nd.player_id, nd.platform, nd.updated_at
FROM athlete_events ae
LEFT JOIN notification_devices nd ON nd.strava_id = ae.strava_id
WHERE ae.strava_id = <strava_id>;
```

### Verificar token Strava de um atleta
```sql
SELECT strava_id, expires_at,
       expires_at > EXTRACT(EPOCH FROM NOW()) AS token_valido
FROM athletes
WHERE strava_id = <strava_id>;
```

### Disparar worker manualmente (produção)
```bash
curl -X POST https://ogt.treine.com.gt/api/internal/strava-worker \
  -H "Authorization: Bearer <INTERNAL_WORKER_SECRET>"
```

### Disparar worker manualmente (local)
```bash
BASE_URL=http://localhost:3000 node scripts/testWebhook.js <activity_id>
```

Para pular o delay de estabilização (apenas para atividades já na fila):
```bash
BASE_URL=http://localhost:3000 node scripts/testWebhook.js <activity_id> 0
```
Nota: o argumento `0` pula o webhook e dispara o worker diretamente.
A atividade precisa estar na fila com `next_run_at <= NOW()` para ser processada.

---

## Diagnóstico Rápido

### Worker retorna `processed: 0`
1. Verificar se há itens na fila: query acima em "Verificar fila"
2. Se fila vazia: o webhook não chegou ou o delay ainda não expirou
3. Se fila com itens no futuro: aguardar ou forçar `next_run_at = NOW()`

### Descrição não atualizada após processamento
1. Verificar `event_activities`: `SELECT * FROM event_activities WHERE strava_activity_id = <id>`
2. Se `processed = false`: dispatcher não rodou ou falhou — verificar logs
3. Se `processed = true`: verificar `engine_last_put_at` em `activities`

### Notificação push não recebida
1. Verificar `push_consent`: query acima em "Verificar status de push"
2. Verificar se device está registrado em `notification_devices`
3. Verificar tags no painel do OneSignal: device deve ter `event_<slug> = true`
4. Se device ausente: atleta precisa acessar o dashboard para registrar o device
