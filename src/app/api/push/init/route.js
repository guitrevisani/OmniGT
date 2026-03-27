// src/app/api/push/init/route.js
//
// GET /api/push/init
//
// Chamado pelo _webpushrScriptReady() no layout em toda página.
// Retorna os atributos de segmentação do atleta autenticado para
// o frontend aplicar via webpushr('attributes', ...).
//
// Sem sessão → { attributes: {} } — silencioso, sem erro.

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { getSession }   from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ attributes: {} });
  }

  const { stravaId } = session;

  const result = await query(
    `SELECT e.slug    AS event_slug,
            ae.role,
            m.slug    AS module_slug
     FROM athlete_events ae
     JOIN events  e ON e.id = ae.event_id
     JOIN modules m ON m.id = e.module_id
     WHERE ae.strava_id = $1
       AND ae.status    = 'active'
       AND e.is_active  = true`,
    [stravaId]
  );

  const attributes = { strava_id: String(stravaId) };
  const eventSlugs  = new Set();
  const moduleSlugs = new Set();

  for (const row of result.rows) {
    attributes[`event_${row.event_slug}`]   = "true";
    attributes[`module_${row.module_slug}`] = "true";
    attributes[`role_${row.event_slug}`]    = row.role || "user";
    eventSlugs.add(row.event_slug);
    moduleSlugs.add(row.module_slug);
  }

  attributes["events_list"]  = [...eventSlugs].join(",")  || "";
  attributes["modules_list"] = [...moduleSlugs].join(",") || "";

  return NextResponse.json({ attributes });
}
