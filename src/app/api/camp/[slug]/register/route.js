// src/app/api/camp/[slug]/register/route.js
import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
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

  // Dados pessoais de athletes + dados do vínculo de camp_athlete_profiles
  const profileResult = await query(
    `SELECT
       a.ftp_w, a.weight_kg, a.hr_max, a.hr_zones,
       a.gender, a.birth_date, a.email, a.whatsapp,
       cap.emergency_name, cap.emergency_phone, cap.medical_clearance
     FROM athletes a
     LEFT JOIN camp_athlete_profiles cap
       ON cap.strava_id = a.strava_id AND cap.event_id = $2
     WHERE a.strava_id = $1`,
    [stravaId, event.id]
  );

  const profile = profileResult.rows[0] || null;

  const enrollResult = await query(
    `SELECT status FROM athlete_events
     WHERE event_id = $1 AND strava_id = $2`,
    [event.id, stravaId]
  );

  const enrolled = enrollResult.rows.length > 0;

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
    profile,
    enrolled,
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
    `SELECT e.id FROM events e
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1 AND e.is_active = true AND m.slug = 'camp'`,
    [slug]
  );

  if (eventResult.rows.length === 0) {
    return NextResponse.json({ error: "Camp não encontrado" }, { status: 404 });
  }

  const eventId = eventResult.rows[0].id;
  const body    = await request.json();

  const {
    ftp_w, weight_kg, hr_max, hr_zones,
    gender, birth_date, email, whatsapp,
    emergency_name, emergency_phone,
    medical_clearance, consent_version,
  } = body;

  // ── Validações ────────────────────────────────────────
  if (!gender)            return NextResponse.json({ error: "Sexo biológico é obrigatório" },       { status: 400 });
  if (!birth_date)        return NextResponse.json({ error: "Data de nascimento é obrigatória" },   { status: 400 });
  if (!weight_kg)         return NextResponse.json({ error: "Peso é obrigatório" },                 { status: 400 });
  if (!email && !whatsapp) return NextResponse.json({ error: "Informe email ou WhatsApp" },         { status: 400 });
  if (!medical_clearance) return NextResponse.json({ error: "Declaração médica é obrigatória" },    { status: 400 });
  if (!consent_version)   return NextResponse.json({ error: "Consentimento é obrigatório" },        { status: 400 });

  // ── Salvar dados pessoais em athletes ─────────────────
  // Sempre sobrescreve — o atleta está editando conscientemente.
  await query(
    `UPDATE athletes SET
       ftp_w      = $2,
       weight_kg  = $3,
       hr_max     = $4,
       hr_zones   = $5,
       gender     = $6,
       birth_date = $7,
       email      = $8,
       whatsapp   = $9,
       updated_at = now()
     WHERE strava_id = $1`,
    [
      stravaId,
      ftp_w     || null,
      weight_kg,
      hr_max    || null,
      hr_zones  ? JSON.stringify(hr_zones) : null,
      gender,
      birth_date,
      email     || null,
      whatsapp  || null,
    ]
  );

  // ── Upsert camp_athlete_profiles (vínculo + emergência + consentimento) ──
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

  // ── Inscrever atleta no evento ────────────────────────
  await query(
    `INSERT INTO athlete_events (strava_id, event_id, role, status)
     VALUES ($1, $2, 'athlete', 'active')
     ON CONFLICT (strava_id, event_id) DO NOTHING`,
    [stravaId, eventId]
  );

  return NextResponse.json({ ok: true });
}
