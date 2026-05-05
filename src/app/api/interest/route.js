// src/app/api/interest/route.js
//
// Registra interesse no segundo camp (ainda sem data/opções definidas).
// Grava em registrations com status = 'waitlist'.
// option é null pois o evento ainda não tem opções configuradas.

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
    const { name, email, whatsapp, event_slug } = await request.json();

    if (!name)       return cors(NextResponse.json({ error: "Nome é obrigatório" },       { status: 400 }));
    if (!email)      return cors(NextResponse.json({ error: "E-mail é obrigatório" },     { status: 400 }));
    if (!event_slug) return cors(NextResponse.json({ error: "event_slug é obrigatório" }, { status: 400 }));

    const eventResult = await query(
      `SELECT id FROM events WHERE slug = $1 AND is_active = true`,
      [event_slug]
    );

    if (eventResult.rows.length === 0) {
      return cors(NextResponse.json({ error: "Evento não encontrado" }, { status: 404 }));
    }

    // Separa nome em firstname/lastname (melhor esforço)
    const parts     = name.trim().split(/\s+/);
    const firstname = parts[0];
    const lastname  = parts.slice(1).join(" ") || null;

    await query(
      `INSERT INTO registrations (
         event_slug, option,
         firstname, lastname,
         email, whatsapp,
         status
       )
       VALUES ($1, NULL, $2, $3, $4, $5, 'waitlist')
       ON CONFLICT (email, event_slug) DO UPDATE SET
         firstname  = EXCLUDED.firstname,
         lastname   = COALESCE(EXCLUDED.lastname, registrations.lastname),
         whatsapp   = COALESCE(EXCLUDED.whatsapp, registrations.whatsapp),
         updated_at = now()`,
      [
        event_slug,
        firstname,
        lastname,
        email.trim().toLowerCase(),
        whatsapp?.trim() || null,
      ]
    );

    return cors(NextResponse.json({ ok: true }));

  } catch (err) {
    console.error("[interest] Erro:", err);
    return cors(NextResponse.json({ error: "Erro interno" }, { status: 500 }));
  }
}
