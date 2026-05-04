// src/app/api/camp/[slug]/register/route.js
import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { queryClient }  from "@/lib/db-client";
import { getSession }   from "@/lib/session";

export const runtime = "nodejs";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request, { params }) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { stravaId } = session;

  const eventResult = await query(
    `SELECT e.id, e.name, e.slug,
            TO_CHAR(e.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(e.end_date,   'YYYY-MM-DD') AS end_date,
            ec.metadata
     FROM events e
     LEFT JOIN event_configs ec ON ec.event_id = e.id
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1 AND e.is_active = true AND m.slug = 'camp'`,
    [slug]
  );

  if (eventResult.rows.length === 0) {
    return NextResponse.json({ error: "Camp não encontrado" }, { status: 404 });
  }

  const event    = eventResult.rows[0];
  const metadata = event.metadata || {};

  // Dados base do atleta + vínculo camp_athlete_profiles
  const profileResult = await query(
    `SELECT
       a.ftp_w, a.weight_kg, a.hr_max, a.hr_zones,
       a.gender, a.birth_date, a.email, a.whatsapp,
       a.firstname, a.lastname,
       cap.emergency_name, cap.emergency_phone, cap.medical_clearance
     FROM athletes a
     LEFT JOIN camp_athlete_profiles cap
       ON cap.strava_id = a.strava_id AND cap.event_id = $2
     WHERE a.strava_id = $1`,
    [stravaId, event.id]
  );

  const profile = profileResult.rows[0] || null;

  // Campos extras já preenchidos no banco do cliente (para pré-preenchimento)
  const extraFields   = metadata.extra_fields || [];
  let   extraValues   = {};
  const clientDbUrl   = metadata.client_db_url || null;

  if (clientDbUrl && extraFields.length > 0) {
    try {
      const clientResult = await queryClient(
        clientDbUrl,
        `SELECT shirt_size, route, race_entry
         FROM jordancamp26_participantes
         WHERE strava_id = $1`,
        [stravaId]
      );
      if (clientResult.rows.length > 0) {
        const row = clientResult.rows[0];
        if (extraFields.includes("shirt_size") && row.shirt_size)
          extraValues.shirt_size = row.shirt_size;
        if (extraFields.includes("route") && row.route)
          extraValues.route = row.route;
        if (extraFields.includes("race_entry") && row.race_entry != null)
          extraValues.race_entry = row.race_entry ? "sim" : "nao";
      }
    } catch (err) {
      console.warn("[camp/register GET] Erro ao buscar extras do cliente:", err);
    }
  }

  return NextResponse.json({
    event: {
      id:         event.id,
      name:       event.name,
      slug:       event.slug,
      start_date: event.start_date,
      end_date:   event.end_date,
      location:   metadata.location  || null,
      objective:  metadata.objective || null,
    },
    extra_fields:  extraFields,
    extra_values:  extraValues,
    profile,
  });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request, { params }) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { stravaId } = session;

  const eventResult = await query(
    `SELECT e.id, ec.metadata
     FROM events e
     JOIN modules m ON m.id = e.module_id
     LEFT JOIN event_configs ec ON ec.event_id = e.id
     WHERE e.slug = $1 AND e.is_active = true AND m.slug = 'camp'`,
    [slug]
  );

  if (eventResult.rows.length === 0) {
    return NextResponse.json({ error: "Camp não encontrado" }, { status: 404 });
  }

  const eventId     = eventResult.rows[0].id;
  const metadata    = eventResult.rows[0].metadata || {};
  const extraFields = metadata.extra_fields  || [];
  const clientDbUrl = metadata.client_db_url || null;

  const body = await request.json();

  const {
    firstname, lastname,
    ftp_w, weight_kg, hr_max, hr_zones,
    gender, birth_date, email, whatsapp,
    emergency_name, emergency_phone,
    medical_clearance, consent_version,
    push_consent,
    extra = {},  // campos específicos do evento
  } = body;

  // ── Validações base ───────────────────────────────────
  if (!firstname)          return NextResponse.json({ error: "Nome é obrigatório" },               { status: 400 });
  if (!lastname)           return NextResponse.json({ error: "Sobrenome é obrigatório" },           { status: 400 });
  if (!gender)             return NextResponse.json({ error: "Sexo biológico é obrigatório" },      { status: 400 });
  if (!birth_date)         return NextResponse.json({ error: "Data de nascimento é obrigatória" },  { status: 400 });
  if (!weight_kg)          return NextResponse.json({ error: "Peso é obrigatório" },                { status: 400 });
  if (!email && !whatsapp) return NextResponse.json({ error: "Informe email ou WhatsApp" },         { status: 400 });
  if (!medical_clearance)  return NextResponse.json({ error: "Declaração médica é obrigatória" },   { status: 400 });
  if (!consent_version)    return NextResponse.json({ error: "Consentimento é obrigatório" },       { status: 400 });

  // ── Validações de campos extras declarados no evento ──
  for (const field of extraFields) {
    if (field === "shirt_size" && !extra.shirt_size)
      return NextResponse.json({ error: "Tamanho de camiseta é obrigatório" }, { status: 400 });
    if (field === "route" && !extra.route)
      return NextResponse.json({ error: "Percurso é obrigatório" },            { status: 400 });
    if (field === "race_entry" && extra.race_entry == null)
      return NextResponse.json({ error: "Informe se está inscrito na prova" }, { status: 400 });
  }

  // ── Atualizar athletes (banco engine) ─────────────────
  await query(
    `UPDATE athletes SET
       firstname  = $2,
       lastname   = $3,
       ftp_w      = $4,
       weight_kg  = $5,
       hr_max     = $6,
       hr_zones   = $7,
       gender     = $8,
       birth_date = $9,
       email      = $10,
       whatsapp   = $11,
       updated_at = now()
     WHERE strava_id = $1`,
    [
      stravaId, firstname, lastname,
      ftp_w     || null, weight_kg,
      hr_max    || null,
      hr_zones  ? JSON.stringify(hr_zones) : null,
      gender, birth_date,
      email    || null,
      whatsapp || null,
    ]
  );

  // ── Upsert camp_athlete_profiles (engine) ─────────────
  const consentIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  await query(
    `INSERT INTO camp_athlete_profiles (
       event_id, strava_id,
       emergency_name, emergency_phone,
       medical_clearance,
       consent_version, consent_at, consent_ip,
       updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,NOW())
     ON CONFLICT (event_id, strava_id) DO UPDATE SET
       emergency_name    = EXCLUDED.emergency_name,
       emergency_phone   = EXCLUDED.emergency_phone,
       medical_clearance = EXCLUDED.medical_clearance,
       consent_version   = EXCLUDED.consent_version,
       consent_at        = NOW(),
       consent_ip        = EXCLUDED.consent_ip,
       updated_at        = NOW()`,
    [
      eventId, stravaId,
      emergency_name  || null,
      emergency_phone || null,
      medical_clearance,
      consent_version,
      consentIp,
    ]
  );

  // ── Gravar campos extras no banco do cliente ──────────
  // Apenas se houver campos extras declarados e client_db_url configurada.
  if (clientDbUrl && extraFields.length > 0) {
    try {
      await queryClient(
        clientDbUrl,
        `UPDATE jordancamp26_participantes SET
           shirt_size = COALESCE($2, shirt_size),
           route      = COALESCE($3, route),
           race_entry = COALESCE($4, race_entry),
           updated_at = now()
         WHERE strava_id = $1`,
        [
          stravaId,
          extraFields.includes("shirt_size") ? extra.shirt_size || null : null,
          extraFields.includes("route")       ? extra.route      || null : null,
          extraFields.includes("race_entry")  ? extra.race_entry         : null,
        ]
      );
    } catch (err) {
      console.error("[camp/register POST] Erro ao gravar extras no cliente:", err);
      // Não bloqueia — dados base já foram salvos
    }
  }

  // ── Inscrever no evento ───────────────────────────────
  await query(
    `INSERT INTO athlete_events (strava_id, event_id, role, status)
     VALUES ($1, $2, 'user', 'active')
     ON CONFLICT (strava_id, event_id) DO NOTHING`,
    [stravaId, eventId]
  );

  const redirectUrl = metadata.post_register_url || null;
  return NextResponse.json({ ok: true, redirect: redirectUrl });
}
