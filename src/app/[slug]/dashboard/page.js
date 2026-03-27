// src/app/[slug]/dashboard/page.js
import { redirect }       from "next/navigation";
import { query }          from "@/lib/db";
import { getSession, hasRequiredScopes } from "@/lib/session";
import AgendaDashboard    from "./AgendaDashboard";
import EstimatorDashboard from "./EstimatorDashboard";
import CampDashboard      from "./CampDashboard";

export const runtime = "nodejs";

const MODULE_COMPONENTS = {
  agenda:    AgendaDashboard,
  estimator: EstimatorDashboard,
  camp:      CampDashboard,
};

export default async function DashboardPage({ params }) {
  const { slug } = await params;

  const result = await query(
    `SELECT e.id, e.name, e.slug, m.slug AS module_slug, m.requires_registration
     FROM events e
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1 AND e.is_active = true`,
    [slug]
  );

  if (result.rows.length === 0) redirect("/");

  const event = result.rows[0];

  if (event.requires_registration) {
    const session = await getSession();

    // Sem sessão → registro/OAuth
    if (!session) redirect(`/${slug}/register`);

    // Verifica se o atleta está inscrito e ativo neste evento
    const member = await query(
      `SELECT status FROM athlete_events
       WHERE strava_id = $1 AND event_id = $2 AND status = 'active'`,
      [session.stravaId, event.id]
    );
    if (member.rows.length === 0) redirect(`/${slug}/register`);

    // Verifica se os scopes concedidos satisfazem os requeridos pelo evento
    const scopeOk = await hasRequiredScopes(session.stravaId, slug);
    if (!scopeOk) redirect(`/api/auth/strava/start?event=${slug}`);
  }

  const Component = MODULE_COMPONENTS[event.module_slug];

  if (!Component) {
    return (
      <div style={{ padding: "2rem", color: "#e2e8f0", fontFamily: "monospace" }}>
        Módulo <strong>{event.module_slug}</strong> não registrado.
      </div>
    );
  }

  return <Component slug={slug} eventId={event.id} eventName={event.name} />;
}
