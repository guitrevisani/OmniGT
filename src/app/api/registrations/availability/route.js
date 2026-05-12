// src/app/api/registrations/availability/route.js
// Retorna vagas disponíveis por opção para exibição pública.
// Não requer autenticação — dados agregados apenas.

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";

export const runtime = "nodejs";

const ALLOWED_ORIGIN = "https://camps.treine.com.gt";

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin",  ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const event_slug = searchParams.get("slug");

  if (!event_slug) {
    return cors(NextResponse.json({ error: "slug é obrigatório" }, { status: 400 }));
  }

  const eventResult = await query(
    `SELECT ec.metadata FROM events e
     LEFT JOIN event_configs ec ON ec.event_id = e.id
     WHERE e.slug = $1 AND e.is_active = true`,
    [event_slug]
  );

  if (eventResult.rows.length === 0) {
    return cors(NextResponse.json({ error: "Evento não encontrado" }, { status: 404 }));
  }

  const metadata           = eventResult.rows[0].metadata || {};
  const limits             = metadata.limits || {};
  const protection2dActive = metadata.protection_2d_active === true;
  const showFrom           = metadata.waitlist_threshold?.["1d_show_available_from"] || 6;

  // Contagem 1d
  const count1d = await query(
    `SELECT COUNT(*) FROM registrations
     WHERE event_slug = $1 AND option = '1d'
       AND status NOT IN ('cancelled','waitlist')`,
    [event_slug]
  );

  // Contagem 2d (proteção)
  const count2d = await query(
    `SELECT COUNT(*) FROM registrations
     WHERE event_slug = $1 AND option = '2d'
       AND status NOT IN ('cancelled','waitlist')`,
    [event_slug]
  );

  // Contagem quartos 2d
  const rooms2d = await query(
    `SELECT COUNT(*) FROM registrations
     WHERE event_slug = $1 AND option = '2d'
       AND status NOT IN ('cancelled','waitlist')
       AND (room_partner IS NULL OR room_partner->>'id' IS NULL)`,
    [event_slug]
  );

  const used1d      = Number(count1d.rows[0].count);
  const reserved2d  = protection2dActive ? Number(count2d.rows[0].count) : 0;
  const limit1d     = limits["1d"] || 15;
  const available1d = Math.max(0, limit1d - used1d - reserved2d);

  const roomsUsed   = Number(rooms2d.rows[0].count);
  const roomsLimit  = limits["2d_rooms"] || 2;
  const available2d = Math.max(0, roomsLimit - roomsUsed);

  // Confirmadas (para exibir "X vagas disponíveis" a partir da 6ª)
  const confirmed1d = await query(
    `SELECT COUNT(*) FROM registrations
     WHERE event_slug = $1 AND option = '1d' AND status = 'confirmed'`,
    [event_slug]
  );
  const totalConfirmed = Number(confirmed1d.rows[0].count);
  const showAvailable  = totalConfirmed >= showFrom;

  return cors(NextResponse.json({
    "1d": {
      available:    available1d,
      limit:        limit1d,
      full:         available1d === 0,
      show_count:   showAvailable,
    },
    "2d": {
      rooms_available: available2d,
      rooms_limit:     roomsLimit,
      full:            available2d === 0,
    },
  }));
}
