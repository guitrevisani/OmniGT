// src/lib/session.js
//
// Sessão por atleta — não por evento.
//
// O cookie "session" identifica o atleta (stravaId).
// O event_id permanece na tabela sessions para auditoria e
// para saber qual foi o evento de entrada, mas NÃO é usado
// para controle de acesso — esse papel é de athlete_events.
//
// Controle de acesso correto:
//   - Autenticado? → sessions WHERE token = $1 AND expires_at > now()
//   - Membro do evento? → athlete_events WHERE strava_id AND event_id AND status = 'active'
//   - Scope suficiente? → athletes.granted_scopes vs events.required_scopes

import { cookies } from "next/headers";
import { query }   from "@/lib/db";

/**
 * Lê e valida a sessão atual.
 * Retorna { stravaId, token } se válida, null se ausente/expirada.
 *
 * Uso em Server Components e Route Handlers:
 *   const session = await getSession();
 *
 * Uso em Route Handlers com acesso ao request:
 *   const session = await getSession(request);
 */
export async function getSession(request = null) {
  let token;

  if (request) {
    token = request.cookies.get("session")?.value;
  } else {
    const cookieStore = await cookies();
    token = cookieStore.get("session")?.value;
  }

  if (!token) return null;

  try {
    const result = await query(
      `SELECT strava_id
       FROM sessions
       WHERE token = $1
         AND expires_at > now()`,
      [token]
    );

    if (result.rows.length === 0) return null;

    return {
      stravaId: Number(result.rows[0].strava_id),
      token,
    };
  } catch (err) {
    console.error("[Session] Erro ao validar sessão:", err);
    return null;
  }
}

/**
 * Cria uma nova sessão no banco e retorna o token UUID.
 * event_id mantido na tabela para auditoria (qual evento gerou a sessão).
 * expires_at = end_date do evento de entrada.
 */
export async function createSession(stravaId, eventId, eventEndDate) {
  const { randomUUID } = await import("crypto");
  const token = randomUUID();

  await query(
    `INSERT INTO sessions (token, strava_id, event_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, stravaId, eventId, new Date(new Date(eventEndDate).setHours(23, 59, 59, 999))]
  );

  return token;
}

/**
 * Invalida o token no banco (logout).
 */
export async function destroySession(token) {
  if (!token) return;
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

/**
 * Verifica se o atleta tem os scopes necessários para um evento.
 * Retorna true se suficiente, false se precisar de novo OAuth.
 *
 * Lógica de suficiência:
 *   required_scopes do evento é um subconjunto de granted_scopes do atleta.
 *   "activity:read_all" satisfaz "activity:read".
 */
export async function hasRequiredScopes(stravaId, eventSlug) {
  const result = await query(
    `SELECT a.granted_scopes, e.required_scopes
     FROM athletes a, events e
     WHERE a.strava_id = $1
       AND e.slug = $2
       AND e.is_active = true`,
    [stravaId, eventSlug]
  );

  if (result.rows.length === 0) return false;

  const { granted_scopes, required_scopes } = result.rows[0];
  if (!required_scopes) return true;
  if (!granted_scopes)  return false;

  const granted  = granted_scopes.split(",").map(s => s.trim());
  const required = required_scopes.split(",").map(s => s.trim());

  return required.every(req => {
    // activity:read_all satisfaz activity:read
    if (req === "activity:read") {
      return granted.includes("activity:read") || granted.includes("activity:read_all");
    }
    return granted.includes(req);
  });
}
