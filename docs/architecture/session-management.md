# Gerenciamento de Sessões

**Arquivo:** `src/lib/session.js`
**ADR:** `docs/decisions/ADR-008-session-tokens.md`

---

## Modelo

O cookie `session` carrega um token UUID opaco.
A relação `token → strava_id + event_id` é resolvida no banco, na tabela `sessions`.

Nunca é exposto `strava_id` diretamente no cookie.

---

## API

```javascript
import { getSession, createSession, destroySession } from "@/lib/session";

// Lê e valida a sessão do request atual
const session = await getSession(request?);
// → { stravaId, eventId, token } | null

// Cria nova sessão (no callback OAuth)
const token = await createSession(stravaId, eventId, eventEndDate);
// → UUID string

// Destroi a sessão (no logout)
await destroySession(token);
```

---

## Ciclo de Vida

```
/api/auth/strava/callback
│  createSession(stravaId, eventId, endDate)
│    INSERT INTO sessions (token, strava_id, event_id, expires_at)
│    expires_at = end_date do evento (meia-noite UTC do último dia)
│  Set-Cookie: session=<token>; HttpOnly; Path=/; SameSite=Lax
▼
Requests subsequentes
│  getSession(request)
│    Lê cookie → busca sessions WHERE token = $1 AND expires_at > now()
│    Retorna { stravaId, eventId, token } | null
▼
/api/auth/strava/logout
│  POST → destroySession(token)
│    DELETE FROM sessions WHERE token = $1
│  Clear cookie
│  Redirect → /{slug}/register
```

---

## Expiração

Sessões expiram automaticamente no `end_date` do evento.
A validação é feita no banco (`expires_at > now()`), não no cookie.

Sessões expiradas permanecem no banco até limpeza manual.
Ver TO DO em `docs/architecture/database-schema.md`.

---

## Múltiplas Sessões

Um atleta pode ter sessões simultâneas em múltiplos devices ou eventos.
Cada autenticação gera um novo token — não há invalidação de sessões anteriores
do mesmo atleta (exceto logout explícito no device atual).

---

## Compatibilidade

Sessões antigas no formato `strava_id` nu (antes da ADR-008) retornam `null`
em `getSession`, forçando redirect para `/register`. Comportamento correto.
