// src/app/api/events/create/route.js
//
// POST /api/events/create
//
// Proteção em camadas:
//   1. middleware.js → exige cookie "session" (Strava OAuth)
//   2. Esta route → verifica se stravaId é PROVIDER (env) ou OWNER
//      de algum evento ativo via athlete_events
//
// OWNER: owner_strava_id é fixado como o próprio stravaId (segurança server-side)
// PROVIDER: aceita qualquer owner_strava_id do payload
//
// Cria em transação única:
//   events → event_configs → camp_sessions → athlete_events (OWNER)

import { NextResponse }      from "next/server";
import { query, getClient }  from "@/lib/db";
import { getSession }        from "@/lib/session";

export const runtime = "nodejs";

// ── Resolve permissão de criação ──────────────────────────────────────────────

async function resolveCreatorRole(stravaId) {
  const providerStravaId = Number(process.env.PROVIDER_STRAVA_ID);
  if (stravaId === providerStravaId) return "provider";

  const result = await query(
    `SELECT 1 FROM athlete_events ae
     JOIN events e ON e.id = ae.event_id
     WHERE ae.strava_id = $1
       AND ae.role IN ('owner', 'provider')
       AND ae.status = 'active'
       AND e.is_active = true
     LIMIT 1`,
    [stravaId]
  );

  return result.rows.length > 0 ? "owner" : null;
}

// ── Validação ─────────────────────────────────────────────────────────────────

function validate(body) {
  const errors = [];
  if (!body.name?.trim())  errors.push("name é obrigatório");
  if (!body.slug?.trim())  errors.push("slug é obrigatório");
  if (!body.start_date)    errors.push("start_date é obrigatório");
  if (!body.end_date)      errors.push("end_date é obrigatório");
  if (body.start_date > body.end_date)
    errors.push("start_date deve ser anterior a end_date");
  if (!/^[a-z0-9-]+$/.test(body.slug || ""))
    errors.push("slug: apenas letras minúsculas, números e hífens");
  return errors;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request) {

  // 1. Sessão Strava
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const { stravaId } = session;

  // 2. Role check — PROVIDER ou OWNER
  const creatorRole = await resolveCreatorRole(stravaId);
  if (!creatorRole) {
    return NextResponse.json(
      { error: "Acesso negado. Apenas OWNER ou PROVIDER podem criar eventos." },
      { status: 403 }
    );
  }

  // 3. Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  // 4. Validação
  const errors = validate(body);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const {
    name,
    slug,
    start_date,
    end_date,
    access_mode  = "private",
    is_active    = true,
    push_heading = null,
    push_body    = null,
    metadata     = {},
    config       = {},
    sessions     = [],
  } = body;

  // OWNER não pode definir outro owner_strava_id — é sempre ele mesmo (server-side)
  // PROVIDER pode definir qualquer owner via payload
  const ownerStravaId = creatorRole === "provider"
    ? (body.owner_strava_id || stravaId)
    : stravaId;

  // 5. Transação
  const client = await getClient();

  try {
    await client.query("BEGIN");

    // 5a. module_id do módulo camp
    const moduleResult = await client.query(
      "SELECT id FROM modules WHERE slug = 'camp' AND is_active = true LIMIT 1"
    );
    if (moduleResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Módulo 'camp' não encontrado ou inativo" },
        { status: 500 }
      );
    }
    const moduleId = moduleResult.rows[0].id;

    // 5b. Slug único
    const slugCheck = await client.query(
      "SELECT id FROM events WHERE slug = $1",
      [slug.trim()]
    );
    if (slugCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Slug '${slug}' já está em uso` }, { status: 409 });
    }

    // 5c. INSERT events
    const eventResult = await client.query(
      `INSERT INTO events
         (name, slug, start_date, end_date, is_active, access_mode,
          module_id, required_scopes, owner_strava_id,
          push_heading, push_body, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       RETURNING id, name, slug`,
      [
        name.trim(), slug.trim(), start_date, end_date,
        is_active, access_mode, moduleId,
        "read,activity:read_all",
        ownerStravaId, push_heading, push_body,
      ]
    );
    const event   = eventResult.rows[0];
    const eventId = event.id;

    // 5d. INSERT event_configs
    await client.query(
      `INSERT INTO event_configs
         (event_id, color_primary, color_secondary, logo_url, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
      [
        eventId,
        config.color_primary   || null,
        config.color_secondary || null,
        config.logo_url        || null,
        JSON.stringify({
          location:    metadata.location    || null,
          objective:   metadata.objective   || null,
          website_url: metadata.website_url || null,
          max_days:    metadata.max_days    || null,
        }),
      ]
    );

    // 5e. INSERT camp_sessions — todos os campos editáveis da tabela
    let sessionsCreated = 0;
    for (const s of sessions) {
      if (!s.name?.trim() || !s.activity_type) continue;
      await client.query(
        `INSERT INTO camp_sessions
           (event_id, day_number, session_order, name,
            short_description, description, activity_type,
            strava_route_id, scheduled_date, scheduled_start,
            objective, is_optional, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
        [
          eventId,
          s.day_number      || 1,
          s.session_order   || 1,
          s.name.trim(),
          s.short_description || null,
          s.description       || null,
          s.activity_type,
          s.strava_route_id   || null,
          s.scheduled_date    || null,
          s.scheduled_start   || null,
          s.objective         || null,
          s.is_optional       ?? false,
        ]
      );
      sessionsCreated++;
    }

    // 5f. athlete_events: owner como OWNER
    await client.query(
      `INSERT INTO athlete_events
         (strava_id, event_id, role, status, push_consent, joined_at, created_at)
       VALUES ($1,$2,'owner','active',false,NOW(),NOW())
       ON CONFLICT (strava_id, event_id) DO UPDATE SET
         role = CASE
           WHEN athlete_events.role = 'provider' THEN athlete_events.role
           ELSE 'owner'
         END,
         status = 'active'`,
      [ownerStravaId, eventId]
    );

    // Se PROVIDER criou para outro owner, registra o provider também no evento
    if (creatorRole === "provider" && stravaId !== ownerStravaId) {
      await client.query(
        `INSERT INTO athlete_events
           (strava_id, event_id, role, status, push_consent, joined_at, created_at)
         VALUES ($1,$2,'provider','active',false,NOW(),NOW())
         ON CONFLICT (strava_id, event_id) DO UPDATE SET
           role = 'provider', status = 'active'`,
        [stravaId, eventId]
      );
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success:          true,
      creator_role:     creatorRole,
      sessions_created: sessionsCreated,
      event: { id: event.id, name: event.name, slug: event.slug },
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[events/create] Erro:", err);
    if (err.code === "23505") {
      return NextResponse.json({ error: "Slug já em uso" }, { status: 409 });
    }
    return NextResponse.json({ error: "Erro interno ao criar evento" }, { status: 500 });
  } finally {
    client.release();
  }
}
