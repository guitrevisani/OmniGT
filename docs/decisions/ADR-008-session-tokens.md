# ADR-008 — Sessões por Token UUID no Banco

**Status:** Aceito
**Data:** 2026-03

---

## Contexto

O modelo original de sessão usava o `strava_id` diretamente como valor do cookie.
Isso expõe o identificador do atleta no browser, impede expiração controlada pelo servidor
e não suporta múltiplos eventos ou logout remoto.

---

## Decisão

Sessões são gerenciadas no banco de dados na tabela `sessions`.
O cookie `session` carrega apenas um token UUID opaco, sem significado fora do servidor.

```
Cookie: session=<uuid>
sessions: token → strava_id + event_id + expires_at
```

---

## Consequências

**Positivas:**
- `strava_id` nunca exposto no browser
- Expiração controlada pelo servidor (≤ `end_date` do evento)
- Logout real: basta deletar o registro do banco
- Múltiplas sessões simultâneas por atleta (múltiplos devices)
- Sessões por evento: um atleta pode estar em múltiplos eventos com sessões independentes

**Negativas:**
- Query extra por request para resolver o token
- Sessões expiradas acumulam no banco até limpeza manual

**Compatibilidade:**
Sessões antigas (strava_id nu) retornam `null` em `getSession`, forçando
re-autenticação. Comportamento correto — sem migração necessária.
