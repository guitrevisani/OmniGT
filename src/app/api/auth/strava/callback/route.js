// src/app/api/auth/strava/callback/route.js
import { NextResponse }  from "next/server";
import { query }         from "@/lib/db";
import { queryClient }   from "@/lib/db-client";  // conexão banco do cliente
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

const REQUIRED_CLUB_ID = 1032654;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code        = searchParams.get("code");
  const eventSlug   = searchParams.get("state");
  const stravaError = searchParams.get("error");
  const goalKm      = searchParams.get("goal_km");
  const goalHours   = searchParams.get("goal_hours");
  const keepGoals   = searchParams.get("keep_goals") !== "0";
  const pushConsent = searchParams.get("push_consent") === "1";

  console.log("[Callback] searchParams:", {
    code:      code ? code.substring(0, 8) + "..." : null,
    stravaError,
    eventSlug,
    allParams: Object.fromEntries(searchParams.entries()),
  });

  if (stravaError) {
    const slug = eventSlug || "";
    return NextResponse.redirect(
      new URL(`/${slug}/register?error=strava_${stravaError}`, request.url)
    );
  }

  if (!code || !eventSlug) {
    return NextResponse.json(
      { error: "Parâmetros ausentes: code ou state" },
      { status: 400 }
    );
  }

  try {
    // ── 1. Buscar evento + módulo ─────────────────────────
    const eventResult = await query(
      `SELECT e.id, e.end_date, e.owner_strava_id, e.required_scopes,
              m.slug AS module_slug,
              ec.metadata
       FROM events e
       JOIN modules m ON m.id = e.module_id
       LEFT JOIN event_configs ec ON ec.event_id = e.id
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
    const metadata     = event.metadata || {};
    const clientDbUrl  = metadata.client_db_url || null;

    // ── 2. Trocar code por tokens ─────────────────────────
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type:    "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    console.log("[Callback] Strava token response:", {
      status: tokenRes.status,
      ok:     tokenRes.ok,
      error:  tokenData.message || null,
      errors: tokenData.errors  || null,
    });

    if (!tokenRes.ok || !tokenData.access_token || !tokenData.athlete) {
      return NextResponse.json(
        { error: "Falha na autenticação Strava", details: tokenData },
        { status: 400 }
      );
    }

    const { athlete, access_token, refresh_token, expires_at, scope } = tokenData;
    const stravaId = athlete.id;

    const genderFromStrava =
      athlete.sex === "M" ? "masculino" :
      athlete.sex === "F" ? "feminino"  : null;

    // URL de perfil do token (fallback se a chamada completa falhar)
    let profileUrl = athlete.profile || athlete.profile_medium || null;

    // ── 3. GET /athlete — FTP, peso e foto em alta res ────
    let ftpW     = null;
    let weightKg = null;

    try {
      const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      if (athleteRes.ok) {
        const full = await athleteRes.json();
        ftpW       = full.ftp    ? Number(full.ftp)    : null;
        weightKg   = full.weight ? Number(full.weight) : null;
        // profile (256×256) tem melhor resolução que profile_medium (62×62)
        profileUrl = full.profile || full.profile_medium || profileUrl;
      } else {
        console.warn("[Callback] GET /athlete falhou:", athleteRes.status);
      }
    } catch (err) {
      console.warn("[Callback] Erro ao buscar dados completos do atleta:", err);
    }

    // ── 4. Verificar membership no clube (camp) ───────────
    // GET /athlete/clubs funciona com escopo "read" e retorna
    // todos os clubes do atleta autenticado (máx 100 por página).
    let isMember = false;

    if (moduleSlug === "camp") {
      try {
        const clubsRes = await fetch(
          "https://www.strava.com/api/v3/athlete/clubs?per_page=100",
          { headers: { Authorization: `Bearer ${access_token}` } }
        );

        if (clubsRes.ok) {
          const clubs = await clubsRes.json();
          isMember = Array.isArray(clubs) &&
            clubs.some(c => Number(c.id) === REQUIRED_CLUB_ID);
        } else {
          console.warn("[Callback] GET /athlete/clubs falhou:", clubsRes.status);
        }
      } catch (err) {
        console.warn("[Callback] Erro ao verificar clube:", err);
      }
    }

    // ── 5. UPSERT atleta (banco da engine) ────────────────
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
      [
        stravaId, athlete.firstname, athlete.lastname,
        access_token, refresh_token, expires_at, scope || null,
        genderFromStrava, athlete.email || null,
      ]
    );

    // ── 6. UPSERT participante (banco do cliente) ─────────
    // email/whatsapp/emergência chegam depois via formulário de inscrição.
    // Não bloqueia o fluxo principal se o banco do cliente falhar.
    try {
      await queryClient(
        clientDbUrl,
        `INSERT INTO jordancamp26_participantes (
           strava_id, firstname, lastname, profile_url,
           gender, ftp_w, weight_kg, event_slug
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (strava_id) DO UPDATE SET
           firstname   = EXCLUDED.firstname,
           lastname    = EXCLUDED.lastname,
           profile_url = EXCLUDED.profile_url,
           gender      = COALESCE(jordancamp26_participantes.gender, EXCLUDED.gender),
           ftp_w       = COALESCE(EXCLUDED.ftp_w,     jordancamp26_participantes.ftp_w),
           weight_kg   = COALESCE(EXCLUDED.weight_kg, jordancamp26_participantes.weight_kg),
           updated_at  = now()`,
        [
          stravaId, athlete.firstname, athlete.lastname, profileUrl,
          genderFromStrava, ftpW, weightKg, eventSlug,
        ]
      );
    } catch (err) {
      console.error("[Callback] Erro ao semear banco do cliente:", err);
    }

    // ── 7. Determinar role ────────────────────────────────
    const providerStravaId = Number(process.env.PROVIDER_STRAVA_ID);
    let role;
    if (stravaId === providerStravaId) {
      role = "provider";
    } else if (event.owner_strava_id && stravaId === Number(event.owner_strava_id)) {
      role = "owner";
    } else {
      role = "user";
    }

    // ── 8. UPSERT athlete_events ──────────────────────────
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

    // ── 9. Metas + backfill (apenas módulo agenda) ────────
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

    // ── 10. Criar sessão ──────────────────────────────────
    const sessionToken = await createSession(stravaId, eventId, eventEndDate);

    // ── 11. Redirect pós-OAuth ────────────────────────────
    let redirectPath = `/${eventSlug}`;

    if (moduleSlug === "camp") {
      const profile = await query(
        `SELECT id FROM camp_athlete_profiles
         WHERE strava_id = $1 AND event_id = $2`,
        [stravaId, eventId]
      );

      if (profile.rows.length > 0) {
        // Já completou o formulário → dashboard
        redirectPath = `/${eventSlug}/dashboard`;
      } else {
        // Ainda não inscrito → apresentação com status de membro na URL.
        // CampPresentation lê ?member=1|0 para exibir o CTA correto
        // sem precisar de uma segunda chamada ao Strava.
        const safeName = encodeURIComponent(athlete.firstname || "");
        redirectPath = `/${eventSlug}?member=${isMember ? "1" : "0"}&name=${safeName}`;
      }
    }

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
