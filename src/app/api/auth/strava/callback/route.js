// /src/app/api/auth/strava/callback/route.js
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code        = searchParams.get("code");
  const eventSlug   = searchParams.get("state");
  const goalKm      = searchParams.get("goal_km");
  const goalHours   = searchParams.get("goal_hours");
  const keepGoals   = searchParams.get("keep_goals") !== "0";
  const pushConsent = searchParams.get("push_consent") === "1";

  if (!code || !eventSlug) {
    return NextResponse.json({ error: "Parâmetros ausentes: code ou state" }, { status: 400 });
  }

  try {
    // ── 1. Buscar evento + módulo ─────────────────────────
    const eventResult = await query(
      `SELECT e.id, e.end_date, e.owner_strava_id, e.required_scopes, m.slug AS module_slug
       FROM events e
       JOIN modules m ON m.id = e.module_id
       WHERE e.slug = $1 AND e.is_active = true`,
      [eventSlug]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Evento inválido ou inativo" }, { status: 400 });
    }

    const event        = eventResult.rows[0];
    const eventId      = event.id;
    const moduleSlug   = event.module_slug;
    const eventEndDate = event.end_date;

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

    // Mapear sex → gender ('M' → 'masculino', 'F' → 'feminino')
    const genderFromStrava = athlete.sex === "M"
      ? "masculino"
      : athlete.sex === "F"
        ? "feminino"
        : null;

    // ── 3. UPSERT atleta ──────────────────────────────────
    // gender e email são persistidos se disponíveis no payload.
    // Não sobrescrevem valores já informados pelo atleta no formulário
    // — só preenchem se ainda estiverem null.
    await query(
      `INSERT INTO athletes (
         strava_id, firstname, lastname,
         access_token, refresh_token, expires_at,
         granted_scopes, gender, email,
         updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (strava_id) DO UPDATE SET
         firstname      = EXCLUDED.firstname,
         lastname       = EXCLUDED.lastname,
         access_token   = EXCLUDED.access_token,
         refresh_token  = EXCLUDED.refresh_token,
         expires_at     = EXCLUDED.expires_at,
         granted_scopes = EXCLUDED.granted_scopes,
         gender         = COALESCE(athletes.gender, EXCLUDED.gender),
         email          = COALESCE(athletes.email,  EXCLUDED.email),
         updated_at     = now()`,
      [stravaId, athlete.firstname, athlete.lastname,
       access_token, refresh_token, expires_at, scope || null,
       genderFromStrava, athlete.email || null]
    );

    // ── 4. Determinar role ────────────────────────────────
    const providerStravaId = Number(process.env.PROVIDER_STRAVA_ID);
    let role;
    if (stravaId === providerStravaId) {
      role = "provider";
    } else if (event.owner_strava_id && stravaId === Number(event.owner_strava_id)) {
      role = "owner";
    } else {
      role = "user";
    }

    // ── 5. UPSERT athlete_events ──────────────────────────
    await query(
      `INSERT INTO athlete_events (strava_id, event_id, role, status, push_consent)
       VALUES ($1,$2,$3,'active',$4)
       ON CONFLICT (strava_id, event_id) DO UPDATE SET
         status       = 'active',
         push_consent = CASE WHEN EXCLUDED.push_consent = true THEN true ELSE athlete_events.push_consent END,
         role         = CASE
           WHEN athlete_events.role IN ('provider','owner','admin') THEN athlete_events.role
           ELSE EXCLUDED.role
         END`,
      [stravaId, eventId, role, pushConsent]
    );

    // ── 6. Metas + backfill (apenas módulo agenda) ────────
    if (moduleSlug === "agenda") {

      if (keepGoals) {
        const existing = await query(
          `SELECT goal_distance_km FROM agenda_goals
           WHERE event_id = $1 AND strava_id = $2`,
          [eventId, stravaId]
        );

        if (existing.rows.length === 0) {
          const sessionToken = await createSession(stravaId, eventId, eventEndDate);
          const response = NextResponse.redirect(
            new URL(`/${eventSlug}/register?warn=no_goals`, request.url)
          );
          response.cookies.set("session", sessionToken, {
            httpOnly: true,
            secure:   process.env.NODE_ENV === "production",
            sameSite: "lax",
            path:     "/",
            expires:  new Date(eventEndDate),
          });
          return response;
        }

      } else {
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
      }

      const base = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
      fetch(`${base}/api/agenda/backfill`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${process.env.INTERNAL_WORKER_SECRET}`,
        },
        body: JSON.stringify({ strava_id: stravaId, event_id: eventId }),
      }).catch(err => console.error("[Callback] Erro ao disparar backfill:", err));
    }

    // ── 7. Criar sessão ───────────────────────────────────
    const sessionToken = await createSession(stravaId, eventId, eventEndDate);

    // ── 8. Cookie + redirect ──────────────────────────────
    const redirectPath = moduleSlug === 'camp' ? `/${eventSlug}/register` : `/${eventSlug}`;
    const response = NextResponse.redirect(new URL(redirectPath, request.url));
    response.cookies.set("session", sessionToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      path:     "/",
      expires:  new Date(eventEndDate),
    });

    return response;

  } catch (error) {
    console.error("[OAuth Callback] Erro:", error);
    return NextResponse.json({ error: "OAuth failed" }, { status: 500 });
  }
}
