// /src/app/api/push/register/route.js
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/push/register
 * Salva player_id do OneSignal em notification_devices e aplica tags.
 */
export async function POST(request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
    }

    const { stravaId } = session;
    const { player_id, platform } = await request.json();

    if (!player_id) {
      return NextResponse.json({ error: "player_id ausente" }, { status: 400 });
    }

    await query(
      `INSERT INTO notification_devices (strava_id, player_id, platform, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (strava_id, player_id) DO UPDATE SET
         platform   = EXCLUDED.platform,
         updated_at = now()`,
      [stravaId, player_id, platform || null]
    );

    const appId  = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_API_KEY;

    if (appId && apiKey) {
      const eventsResult = await query(
        `SELECT e.slug FROM athlete_events ae
         JOIN events e ON e.id = ae.event_id
         WHERE ae.strava_id = $1 AND ae.status = 'active' AND e.is_active = true`,
        [stravaId]
      );

      const tags = { strava_id: String(stravaId) };
      eventsResult.rows.forEach(r => { tags[`event_${r.slug}`] = "true"; });

      fetch(`https://onesignal.com/api/v1/apps/${appId}/users/${player_id}`, {
        method:  "PATCH",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Basic ${apiKey}`,
        },
        body: JSON.stringify({ tags }),
      }).catch(err => console.error("[Push] Erro ao aplicar tags:", err));
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[Push Register] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
