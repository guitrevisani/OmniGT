// src/app/api/push/register/route.js
//
// POST /api/push/register
//
// Salva o subscriber_id (SID) do Webpushr vinculado ao strava_id.
// A associação de atributos (strava_id, event_slug, role, etc.) é feita
// pelo JavaScript do Webpushr no frontend — não há endpoint REST para isso.
//
// Este endpoint faz apenas:
//   1. Persiste notification_devices (strava_id ↔ subscriber_id)
//   2. Retorna os atributos que o frontend deve passar ao Webpushr via JS

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { getSession }   from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
    }

    const { stravaId } = session;
    const { subscriber_id, platform } = await request.json();

    if (!subscriber_id) {
      return NextResponse.json({ error: "subscriber_id ausente" }, { status: 400 });
    }

    // 1. Persiste/atualiza device
    // Mantém player_id como nome da coluna por compatibilidade —
    // renomear futuramente via: ALTER TABLE notification_devices RENAME COLUMN player_id TO subscriber_id;
    await query(
      `INSERT INTO notification_devices (strava_id, player_id, platform, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (strava_id, player_id) DO UPDATE SET
         platform   = EXCLUDED.platform,
         updated_at = now()`,
      [stravaId, subscriber_id, platform || null]
    );

    // 2. Busca eventos ativos do atleta com role e módulo
    //    para montar os atributos que o frontend vai passar ao Webpushr via JS
    const eventsResult = await query(
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

    // 3. Monta objeto de atributos para o frontend chamar:
    //    webpushr('attributes', attributes)
    const attributes = {
      strava_id: String(stravaId),
    };

    const eventSlugs  = new Set();
    const moduleSlugs = new Set();

    for (const row of eventsResult.rows) {
      attributes[`event_${row.event_slug}`]   = "true";
      attributes[`module_${row.module_slug}`] = "true";
      attributes[`role_${row.event_slug}`]    = row.role || "user";
      eventSlugs.add(row.event_slug);
      moduleSlugs.add(row.module_slug);
    }

    attributes["events_list"]  = [...eventSlugs].join(",")  || "";
    attributes["modules_list"] = [...moduleSlugs].join(",") || "";

    // Retorna os atributos para o frontend aplicar via JS
    return NextResponse.json({ ok: true, attributes });

  } catch (err) {
    console.error("[Push Register] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
