// src/app/api/internal/validate-access/route.js
import { NextResponse } from "next/server";
import { query }        from "@/lib/db";
import { getSession }   from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { slug } = await request.json();

    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    const eventResult = await query(
      "SELECT id FROM events WHERE slug = $1 AND is_active = true",
      [slug]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json({ valid: false }, { status: 404 });
    }

    const eventId = eventResult.rows[0].id;

    const roleResult = await query(
      `SELECT role, status FROM athlete_events
       WHERE strava_id = $1 AND event_id = $2`,
      [session.stravaId, eventId]
    );

    if (roleResult.rows.length === 0) {
      return NextResponse.json({ valid: false }, { status: 403 });
    }

    const { role, status } = roleResult.rows[0];

    if (status !== "active") {
      return NextResponse.json({ valid: false }, { status: 403 });
    }

    return NextResponse.json({ valid: true, role });

  } catch (error) {
    console.error("Validate access error:", error);
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
