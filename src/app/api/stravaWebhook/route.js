import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const ENGINE_LOOP_GUARD_SECONDS   = 120;
const STABILIZATION_DELAY_SECONDS = 300;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.STRAVA_VERIFY_TOKEN) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const { object_type, aspect_type, object_id, owner_id, event_time, updates } = payload;

    if (object_type !== "activity") {
      return NextResponse.json({ ignored: true });
    }

    const activityId = object_id;
    const stravaId   = owner_id;

    // ── Auditoria ─────────────────────────────────────────
    await query(
      `INSERT INTO strava_events
         (object_type, aspect_type, object_id, owner_id, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT DO NOTHING`,
      [object_type, aspect_type, activityId, stravaId, JSON.stringify(payload)]
    );

    // ── UPSERT em activities ──────────────────────────────
    // Persiste last_webhook_updates para o worker decidir
    // se deve reprocessar atividades posteriores.
    await query(
      `INSERT INTO activities
         (strava_activity_id, strava_id,
          start_date, last_webhook_aspect, last_webhook_updates,
          last_webhook_at, last_strava_update_at)
       VALUES ($1,$2,NOW(),$3,$4,NOW(),to_timestamp($5))
       ON CONFLICT (strava_activity_id) DO UPDATE SET
         last_webhook_aspect   = EXCLUDED.last_webhook_aspect,
         last_webhook_updates  = EXCLUDED.last_webhook_updates,
         last_webhook_at       = NOW(),
         last_strava_update_at = to_timestamp($5)`,
      [activityId, stravaId, aspect_type, updates ? JSON.stringify(updates) : null, event_time]
    );

    // ── Loop guard ────────────────────────────────────────
    const loopCheck = await query(
      `SELECT engine_last_put_at FROM activities WHERE strava_activity_id = $1`,
      [activityId]
    );

    if (loopCheck.rows.length > 0 && loopCheck.rows[0].engine_last_put_at) {
      const diffSec = (Date.now() - new Date(loopCheck.rows[0].engine_last_put_at).getTime()) / 1000;
      if (diffSec < ENGINE_LOOP_GUARD_SECONDS) {
        console.log(`[Webhook] Loop guard ativado — activity ${activityId}`);
        return NextResponse.json({ ignored: "engine_loop" });
      }
    }

    // ── Enfileirar com delay ──────────────────────────────
    const delay = aspect_type === "delete" ? 0 : STABILIZATION_DELAY_SECONDS;

    await query(
      `INSERT INTO activity_processing_queue (strava_activity_id, next_run_at)
       VALUES ($1, NOW() + ($2 * INTERVAL '1 second'))
       ON CONFLICT (strava_activity_id) DO UPDATE SET
         next_run_at = EXCLUDED.next_run_at`,
      [activityId, delay]
    );

    // ── Disparar worker (fire-and-forget) ─────────────────
    const base = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
    fetch(`${base}/api/internal/strava-worker`, {
      method:  "POST",
      headers: { "Authorization": `Bearer ${process.env.INTERNAL_WORKER_SECRET}` },
    }).catch(err => console.error("[Webhook] Erro ao disparar worker:", err));

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error("[Webhook] Erro:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
