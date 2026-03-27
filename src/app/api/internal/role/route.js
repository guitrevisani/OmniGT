// src/app/api/internal/role/route.js
import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { getSession }   from "@/lib/session";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventSlug = searchParams.get("event");

    if (!eventSlug) {
      return NextResponse.json({ error: "Event slug ausente" }, { status: 400 });
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const eventResult = await query(
      "SELECT id FROM events WHERE slug = $1 AND is_active = true",
      [eventSlug]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Evento inválido" }, { status: 400 });
    }

    const eventId = eventResult.rows[0].id;

    const roleResult = await query(
      `SELECT role, status FROM athlete_events
       WHERE strava_id = $1 AND event_id = $2`,
      [session.stravaId, eventId]
    );

    if (roleResult.rows.length === 0) {
      return NextResponse.json({ error: "Atleta não vinculado ao evento" }, { status: 403 });
    }

    const { role, status } = roleResult.rows[0];
    return NextResponse.json({ role, status });

  } catch (error) {
    console.error("Role API error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
