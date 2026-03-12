// /src/app/[slug]/page.js
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Ponto de entrada de qualquer evento.
 * requires_registration = true  → logado e inscrito? dashboard : register
 * requires_registration = false → dashboard direto
 */
export default async function EventIndexPage({ params }) {
  const { slug } = await params;

  const eventResult = await query(
    `SELECT e.id, m.requires_registration
     FROM events e
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1 AND e.is_active = true`,
    [slug]
  );

  if (eventResult.rows.length === 0) redirect("/");

  const event = eventResult.rows[0];

  if (!event.requires_registration) {
    redirect(`/${slug}/dashboard`);
  }

  const session = await getSession();

  if (!session) redirect(`/${slug}/register`);

  // Confirmar que a sessão pertence a este evento
  if (session.eventId !== event.id) redirect(`/${slug}/register`);

  try {
    const memberResult = await query(
      `SELECT status FROM athlete_events
       WHERE strava_id = $1 AND event_id = $2 AND status = 'active'`,
      [session.stravaId, event.id]
    );
    if (memberResult.rows.length === 0) redirect(`/${slug}/register`);
  } catch {
    redirect(`/${slug}/register`);
  }

  redirect(`/${slug}/dashboard`);
}
