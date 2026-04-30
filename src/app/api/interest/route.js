// src/app/api/waitlist/route.js
//
// Recebe nome, email e whatsapp da landing page externa
// e grava na tabela waitlist do banco do cliente.
//
// A client_db_url vem de event_configs.metadata — mesma
// abordagem do callback, sem ENV VARs por cliente.

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { queryClient }  from "@/lib/db-client";

export const runtime = "nodejs";

const ALLOWED_ORIGIN = "https://camps.treine.com.gt";

function cors(response) {
  response.headers.set("Access-Control-Allow-Origin",  ALLOWED_ORIGIN);
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

// Preflight
export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(request) {
  try {
    const { name, email, whatsapp, event_slug } = await request.json();

    if (!name || !email || !event_slug) {
      return cors(
        NextResponse.json({ error: "name, email e event_slug são obrigatórios" }, { status: 400 })
      );
    }

    // Busca client_db_url no metadata do evento
    const eventResult = await query(
      `SELECT ec.metadata
       FROM events e
       LEFT JOIN event_configs ec ON ec.event_id = e.id
       WHERE e.slug = $1 AND e.is_active = true`,
      [event_slug]
    );

    if (eventResult.rows.length === 0) {
      return cors(
        NextResponse.json({ error: "Evento não encontrado" }, { status: 404 })
      );
    }

    const metadata     = eventResult.rows[0].metadata || {};
    const clientDbUrl  = metadata.client_db_url || null;

    await queryClient(
      clientDbUrl,
      `INSERT INTO waitlist (name, email, whatsapp, event_slug)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email, event_slug) DO NOTHING`,
      [name.trim(), email.trim().toLowerCase(), whatsapp?.trim() || null, event_slug]
    );

    return cors(
      NextResponse.json({ ok: true })
    );

  } catch (err) {
    console.error("[waitlist] Erro:", err);
    return cors(
      NextResponse.json({ error: "Erro interno" }, { status: 500 })
    );
  }
}
