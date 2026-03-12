import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * GET /api/estimator/[slug]
 * Retorna as configurações do evento Estimator.
 * Rota pública — não requer autenticação.
 */
export async function GET(request, { params }) {
  const { slug } = await params;

  const result = await query(
    `SELECT e.id, e.name, e.slug, ec.metadata AS config
     FROM events e
     LEFT JOIN event_configs ec ON ec.event_id = e.id
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1
       AND e.is_active = true
       AND m.slug = 'estimator'`,
    [slug]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  }

  const event = result.rows[0];

  return NextResponse.json({
    id:     event.id,
    name:   event.name,
    slug:   event.slug,
    config: event.config || {},
  });
}
