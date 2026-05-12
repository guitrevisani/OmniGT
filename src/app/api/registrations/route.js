// src/app/api/registrations/route.js
//
// Rota pública de inscrição — não requer OAuth.
// Verifica limites por opção e total antes de inserir.
// Dados fisiológicos agrupados em jsonb (physiological).
// Campos extras específicos do evento em jsonb (extra).

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";

export const runtime = "nodejs";

const ALLOWED_ORIGIN = "https://camps.treine.com.gt";

function cors(response) {
  response.headers.set("Access-Control-Allow-Origin",  ALLOWED_ORIGIN);
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(request) {
  try {
    const body = await request.json();

    const {
      event_slug,
      option,
      firstname,
      lastname,
      email,
      whatsapp,
      gender,        // obrigatório no formulário
      ftp_w,
      weight_kg,
      hr_max,
      emergency_name,
      emergency_phone,
      birth_date,
      cpf,
      health_insurance,
      health_card,
      accommodation,
      room_partner,
      extra,
    } = body;

    // ── Validações base ───────────────────────────────────
    if (!event_slug)          return cors(NextResponse.json({ error: "event_slug é obrigatório" },       { status: 400 }));
    if (!option)              return cors(NextResponse.json({ error: "Opção é obrigatória" },             { status: 400 }));
    if (!firstname)           return cors(NextResponse.json({ error: "Nome é obrigatório" },              { status: 400 }));
    if (!lastname)            return cors(NextResponse.json({ error: "Sobrenome é obrigatório" },         { status: 400 }));
    if (!gender)              return cors(NextResponse.json({ error: "Sexo biológico é obrigatório" },    { status: 400 }));
    if (!email && !whatsapp)  return cors(NextResponse.json({ error: "Informe email ou WhatsApp" },       { status: 400 }));

    // ── Busca evento + metadata ───────────────────────────
    const eventResult = await query(
      `SELECT e.id, e.name, ec.metadata
       FROM events e
       LEFT JOIN event_configs ec ON ec.event_id = e.id
       WHERE e.slug = $1 AND e.is_active = true`,
      [event_slug]
    );

    if (eventResult.rows.length === 0) {
      return cors(NextResponse.json({ error: "Evento não encontrado" }, { status: 404 }));
    }

    const metadata   = eventResult.rows[0].metadata || {};
    const eventName  = eventResult.rows[0].name || "";
    const limits     = metadata.limits || null;

    // ── Verifica limites ──────────────────────────────────
    const protection2dActive = metadata.protection_2d_active === true;

    if (limits) {
      if (option === "1d") {
        const count1d = await query(
          `SELECT COUNT(*) FROM registrations
           WHERE event_slug = $1 AND option = '1d'
             AND status NOT IN ('cancelled','waitlist')`,
          [event_slug]
        );
        const count2d = protection2dActive ? await query(
          `SELECT COUNT(*) FROM registrations
           WHERE event_slug = $1 AND option = '2d'
             AND status NOT IN ('cancelled','waitlist')`,
          [event_slug]
        ) : { rows: [{ count: 0 }] };

        const used1d   = Number(count1d.rows[0].count);
        const reserved = Number(count2d.rows[0].count);
        const limit1d  = limits["1d"] || 15;

        if (used1d + reserved >= limit1d) {
          return cors(NextResponse.json({
            error:    "Vagas esgotadas para esta opção",
            waitlist: true,
          }, { status: 409 }));
        }
      }

      if (option === "2d") {
        const rooms2d = await query(
          `SELECT COUNT(*) FROM registrations
           WHERE event_slug = $1 AND option = '2d'
             AND status NOT IN ('cancelled','waitlist')
             AND (room_partner IS NULL OR room_partner->>'id' IS NULL)`,
          [event_slug]
        );
        const roomsUsed  = Number(rooms2d.rows[0].count);
        const roomsLimit = limits["2d_rooms"] || 2;

        if (roomsUsed >= roomsLimit) {
          return cors(NextResponse.json({
            error:    "Vagas esgotadas para esta opção",
            waitlist: true,
          }, { status: 409 }));
        }
      }
    }

    // ── Monta physiological jsonb ─────────────────────────
    const physiological = {
      ...(gender    ? { gender }              : {}),
      ...(ftp_w     ? { ftp_w: Number(ftp_w) }         : {}),
      ...(weight_kg ? { weight_kg: Number(weight_kg) } : {}),
      ...(hr_max    ? { hr_max: Number(hr_max) }        : {}),
    };

    // ── Insere inscrição ──────────────────────────────────
    const insertResult = await query(
      `INSERT INTO registrations (
         event_slug, option,
         firstname, lastname,
         email, whatsapp,
         physiological,
         emergency_name, emergency_phone,
         birth_date, cpf,
         health_insurance, health_card,
         accommodation, room_partner,
         extra,
         status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')
       ON CONFLICT (email, event_slug) DO UPDATE SET
         option           = EXCLUDED.option,
         firstname        = EXCLUDED.firstname,
         lastname         = EXCLUDED.lastname,
         whatsapp         = EXCLUDED.whatsapp,
         physiological    = EXCLUDED.physiological,
         emergency_name   = EXCLUDED.emergency_name,
         emergency_phone  = EXCLUDED.emergency_phone,
         birth_date       = EXCLUDED.birth_date,
         cpf              = EXCLUDED.cpf,
         health_insurance = EXCLUDED.health_insurance,
         health_card      = EXCLUDED.health_card,
         accommodation    = EXCLUDED.accommodation,
         room_partner     = EXCLUDED.room_partner,
         extra            = EXCLUDED.extra,
         updated_at       = now()
       RETURNING id`,
      [
        event_slug, option,
        firstname.trim(), lastname.trim(),
        email?.trim().toLowerCase() || null,
        whatsapp?.trim() || null,
        Object.keys(physiological).length > 0 ? JSON.stringify(physiological) : null,
        emergency_name?.trim()  || null,
        emergency_phone?.trim() || null,
        birth_date             || null,
        cpf?.trim()            || null,
        health_insurance?.trim() || null,
        health_card?.trim()    || null,
        accommodation          || null,
        room_partner ? JSON.stringify(room_partner) : null,
        extra ? JSON.stringify(extra) : null,
      ]
    );

    // ── Busca id gerado e monta response ─────────────────
    const registrationId = insertResult.rows[0]?.id || null;
    const paymentUrl     = metadata.payment_url || null;

    return cors(NextResponse.json({
      ok:              true,
      registration_id: registrationId,
      event_name:      eventName,
      option,
      payment_url:     paymentUrl,
    }));

  } catch (err) {
    console.error("[registrations] Erro:", err);
    return cors(NextResponse.json({ error: "Erro interno" }, { status: 500 }));
  }
}
