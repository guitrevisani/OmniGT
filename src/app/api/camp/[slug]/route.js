// src/app/api/camp/[slug]/route.js
//
// GET /api/camp/[slug]
//
// Retorna dados públicos do camp para a página de apresentação.
// Não requer autenticação.

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const { slug } = await params;

  const result = await query(
    `SELECT
       e.id,
       e.name,
       e.slug,
       TO_CHAR(e.start_date, 'YYYY-MM-DD') AS start_date,
       TO_CHAR(e.end_date,   'YYYY-MM-DD') AS end_date,
       ec.metadata
     FROM events e
     LEFT JOIN event_configs ec ON ec.event_id = e.id
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug      = $1
       AND e.is_active = true
       AND m.slug      = 'camp'`,
    [slug]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Camp não encontrado" }, { status: 404 });
  }

  const event    = result.rows[0];
  const metadata = event.metadata || {};

  return NextResponse.json({
    id:         event.id,
    name:       event.name,
    slug:       event.slug,
    start_date: event.start_date,
    end_date:   event.end_date,
    location:    metadata.location    || null,
    objective:   metadata.objective   || null,
    website_url: metadata.website_url || null,
  });
}
