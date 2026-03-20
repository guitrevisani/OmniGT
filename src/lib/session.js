// /src/lib/session.js
import { cookies } from "next/headers";
import { query } from "@/lib/db";

/**
 * Lê e valida a sessão atual.
 *
 * Retorna { stravaId, eventId, token } se válida,
 * ou null se ausente / expirada / inválida.
 *
 * Uso em Server Components e Route Handlers:
 *   const session = await getSession();
 *
 * Uso em Route Handlers com acesso ao request (validate-access):
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
      `SELECT strava_id, event_id
       FROM sessions
       WHERE token = $1
         AND expires_at > now()`,
      [token]
    );

    if (result.rows.length === 0) return null;

    return {
      stravaId: Number(result.rows[0].strava_id),
      eventId:  Number(result.rows[0].event_id),
      token,
    };
  } catch (err) {
    console.error("[Session] Erro ao validar sessão:", err);
    return null;
  }
}

/**
 * Cria uma nova sessão no banco e retorna o token UUID.
 * expires_at = end_date do evento.
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
