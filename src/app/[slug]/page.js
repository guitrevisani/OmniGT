import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";

/**
 * Ponto de entrada de qualquer evento.
 * O comportamento de redirect depende da flag requires_registration do módulo:
 *
 * requires_registration = true  (ex: Agenda)
 *   → logado e inscrito? /[slug]/dashboard
 *   → caso contrário?    /[slug]/register
 *
 * requires_registration = false (ex: Estimator)
 *   → sempre /[slug]/dashboard (logado ou não)
 */
export default async function EventIndexPage({ params }) {
  const { slug } = await params;

  // ── Buscar evento + flag do módulo ────────────────────────
  const eventResult = await query(
    `SELECT e.id, e.access_mode, m.requires_registration
     FROM events e
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1 AND e.is_active = true`,
    [slug]
  );

  if (eventResult.rows.length === 0) {
    redirect("/");
  }

  const event = eventResult.rows[0];

  // ── Módulo público → dashboard direto ────────────────────
  if (!event.requires_registration) {
    redirect(`/${slug}/dashboard`);
  }

  // ── Módulo com inscrição → verificar sessão ───────────────
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;

  if (!session) {
    redirect(`/${slug}/register`);
  }

  const stravaId = Number(session);

  try {
    const memberResult = await query(
      `SELECT ae.status
       FROM athlete_events ae
       WHERE ae.strava_id = $1
         AND ae.event_id = $2
         AND ae.status = 'active'`,
      [stravaId, event.id]
    );

    if (memberResult.rows.length === 0) {
      redirect(`/${slug}/register`);
    }
  } catch {
    redirect(`/${slug}/register`);
  }

  redirect(`/${slug}/dashboard`);
}
