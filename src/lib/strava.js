import { query } from "@/lib/db";

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

export async function getValidAccessToken(stravaId) {
  const result = await query(
    `SELECT access_token, refresh_token, expires_at
     FROM athletes
     WHERE strava_id = $1`,
    [stravaId]
  );

  if (result.rows.length === 0) {
    throw new Error("Atleta não encontrado");
  }

  const athlete = result.rows[0];

  const now = Math.floor(Date.now() / 1000);

  // margem de segurança de 60s
  if (athlete.expires_at > now + 60) {
    return athlete.access_token;
  }

  /**
   * 🔄 Token expirado → refresh
   */
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: athlete.refresh_token,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Erro ao atualizar token Strava");
  }

  await query(
    `
    UPDATE athletes
    SET
      access_token = $1,
      refresh_token = $2,
      expires_at = $3,
      updated_at = now()
    WHERE strava_id = $4
    `,
    [
      data.access_token,
      data.refresh_token,
      data.expires_at,
      stravaId,
    ]
  );

  return data.access_token;
}
