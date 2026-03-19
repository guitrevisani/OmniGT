// src/app/[slug]/page.js
//
// Ponto de entrada de qualquer evento.
//
// requires_registration = false → dashboard direto
// requires_registration = true:
//   camp      → renderiza apresentação pública (CampPresentation)
//   outros    → redireciona para register ou dashboard
//
// O Camp tem página de apresentação pública antes da autenticação.
// Os demais módulos mantêm o comportamento anterior.

import { redirect }      from "next/navigation";
import { query }         from "@/lib/db";
import { getSession }    from "@/lib/session";
import CampPresentation  from "./CampPresentation";

export const runtime = "nodejs";

export default async function EventIndexPage({ params }) {
  const { slug } = await params;

  const result = await query(
    `SELECT e.id, e.name, e.slug,
            TO_CHAR(e.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(e.end_date, 'YYYY-MM-DD') AS end_date,
            m.slug AS module_slug,
            m.requires_registration,
            ec.metadata
     FROM events e
     JOIN modules m ON m.id = e.module_id
     LEFT JOIN event_configs ec ON ec.event_id = e.id
     WHERE e.slug = $1 AND e.is_active = true`,
    [slug]
  );

  if (result.rows.length === 0) redirect("/");

  const event    = result.rows[0];
  const metadata = event.metadata || {};

  // Módulos sem registro → dashboard direto
  if (!event.requires_registration) {
    redirect(`/${slug}/dashboard`);
  }

  // Camp → apresentação pública (não requer autenticação)
  if (event.module_slug === "camp") {
    return (
      <CampPresentation
        slug={slug}
        name={event.name}
        startDate={event.start_date}
        endDate={event.end_date}
        location={metadata.location    || null}
        objective={metadata.objective  || null}
        websiteUrl={metadata.website_url || null}
        maxDays={metadata.max_days     || null}
      />
    );
  }

  // Demais módulos com registro → redireciona conforme sessão
  const session = await getSession();
  if (!session) redirect(`/${slug}/register`);
  if (session.eventId !== event.id) redirect(`/${slug}/register`);

  const member = await query(
    `SELECT status FROM athlete_events
     WHERE strava_id = $1 AND event_id = $2 AND status = 'active'`,
    [session.stravaId, event.id]
  );

  if (member.rows.length === 0) redirect(`/${slug}/register`);

  redirect(`/${slug}/dashboard`);
}
