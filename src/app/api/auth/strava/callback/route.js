import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/auth/strava/callback
 *
 * Fluxo:
 * 1. Troca o code OAuth por tokens Strava
 * 2. UPSERT atleta em athletes
 * 3. Determina role: provider > owner > user
 * 4. UPSERT em athlete_events (sem downgrade de role superior)
 * 5. Salva metas em agenda_goals (apenas módulo agenda)
 * 6. Dispara backfill assíncrono (apenas módulo agenda)
 * 7. Cookie de sessão + redirect para /{slug}
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code      = searchParams.get("code");
  const eventSlug = searchParams.get("state");
  const goalKm    = searchParams.get("goal_km");
  const goalHours = searchParams.get("goal_hours");

  if (!code || !eventSlug) {
    return NextResponse.json({ error: "Parâmetros ausentes: code ou state" }, { status: 400 });
  }

  try {
    // ── 1. Buscar evento + módulo ─────────────────────────
    const eventResult = await query(
      `SELECT e.id, e.owner_strava_id, e.required_scopes, m.slug AS module_slug
       FROM events e
       JOIN modules m ON m.id = e.module_id
       WHERE e.slug = $1 AND e.is_active = true`,
      [eventSlug]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Evento inválido ou inativo" }, { status: 400 });
    }

    const event      = eventResult.rows[0];
    const eventId    = event.id;
    const moduleSlug = event.module_slug;

    // ── 2. Trocar code por tokens ─────────────────────────
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token || !tokenData.athlete) {
      return NextResponse.json(
        { error: "Falha na autenticação Strava", details: tokenData },
        { status: 400 }
      );
    }

    const { athlete, access_token, refresh_token, expires_at, scope } = tokenData;
    const stravaId = athlete.id;

    // ── 3. UPSERT atleta ──────────────────────────────────
    await query(
      `INSERT INTO athletes (
         strava_id, firstname, lastname,
         access_token, refresh_token, expires_at,
         granted_scopes, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (strava_id) DO UPDATE SET
         firstname      = EXCLUDED.firstname,
         lastname       = EXCLUDED.lastname,
         access_token   = EXCLUDED.access_token,
         refresh_token  = EXCLUDED.refresh_token,
         expires_at     = EXCLUDED.expires_at,
         granted_scopes = EXCLUDED.granted_scopes,
         updated_at     = now()`,
      [stravaId, athlete.firstname, athlete.lastname,
       access_token, refresh_token, expires_at, scope || null]
    );

    // ── 4. Determinar role ────────────────────────────────
    // provider → ID fixo da plataforma
    // owner    → dono do evento
    // user     → todos os demais
    // admin    → atribuído manualmente, nunca via OAuth
    const providerStravaId = Number(process.env.PROVIDER_STRAVA_ID);
    let role;
    if (stravaId === providerStravaId) {
      role = "provider";
    } else if (event.owner_strava_id && stravaId === Number(event.owner_strava_id)) {
      role = "owner";
    } else {
      role = "user";
    }

    // ── 5. UPSERT athlete_events (sem downgrade) ──────────
    await query(
      `INSERT INTO athlete_events (strava_id, event_id, role, status)
       VALUES ($1,$2,$3,'active')
       ON CONFLICT (strava_id, event_id) DO UPDATE SET
         status = 'active',
         role   = CASE
           WHEN athlete_events.role IN ('provider','owner','admin') THEN athlete_events.role
           ELSE EXCLUDED.role
         END`,
      [stravaId, eventId, role]
    );

    // ── 6. Metas + backfill (apenas módulo agenda) ────────
    if (moduleSlug === "agenda") {
      const parsedGoalKm      = parseFloat(goalKm)    || 0;
      const parsedGoalHours   = parseFloat(goalHours) || 0;
      const goalMovingTimeSec = Math.round(parsedGoalHours * 3600);

      if (parsedGoalKm > 0 || goalMovingTimeSec > 0) {
        await query(
          `INSERT INTO agenda_goals (event_id, strava_id, goal_distance_km, goal_moving_time_sec)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (event_id, strava_id) DO UPDATE SET
             goal_distance_km     = EXCLUDED.goal_distance_km,
             goal_moving_time_sec = EXCLUDED.goal_moving_time_sec,
             updated_at           = now()`,
          [eventId, stravaId, parsedGoalKm, goalMovingTimeSec]
        );
      }

      const base = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
      fetch(`${base}/api/agenda/backfill`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.INTERNAL_WORKER_SECRET}`,
        },
        body: JSON.stringify({ strava_id: stravaId, event_id: eventId }),
      }).catch(err => console.error("[Callback] Erro ao disparar backfill:", err));
    }

    // ── 7. Cookie + redirect ──────────────────────────────
    const response = NextResponse.redirect(new URL(`/${eventSlug}`, request.url));
    response.cookies.set("session", String(stravaId), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      path:     "/",
    });

    return response;

  } catch (error) {
    console.error("[OAuth Callback] Erro:", error);
    return NextResponse.json({ error: "OAuth failed" }, { status: 500 });
  }
}
