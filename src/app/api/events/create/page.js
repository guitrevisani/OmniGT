// src/app/events/create/page.js
// Rota: /events/create
//
// Proteção em camadas:
//   1. middleware.js → exige cookie "session" (sessão Strava ativa)
//   2. Esta page → verifica se stravaId é PROVIDER ou OWNER de algum evento
//
// OWNER: cria evento e se torna owner_strava_id + role "owner" em athlete_events
// PROVIDER: cria evento para qualquer owner (campo owner_strava_id editável)

import { redirect }     from "next/navigation";
import { getSession }   from "@/lib/session";
import { query }        from "@/lib/db";
import CreateCampForm   from "./CreateCampForm";

export const runtime = "nodejs";

export const metadata = {
  title: "Criar Evento Camp",
};

async function checkAccess(stravaId) {
  // PROVIDER: stravaId bate com env
  const providerStravaId = Number(process.env.PROVIDER_STRAVA_ID);
  if (stravaId === providerStravaId) return { allowed: true, role: "provider" };

  // OWNER: tem pelo menos um evento ativo onde é owner
  const result = await query(
    `SELECT 1 FROM athlete_events ae
     JOIN events e ON e.id = ae.event_id
     WHERE ae.strava_id = $1
       AND ae.role IN ('owner', 'provider')
       AND ae.status = 'active'
       AND e.is_active = true
     LIMIT 1`,
    [stravaId]
  );

  if (result.rows.length > 0) return { allowed: true, role: "owner" };

  return { allowed: false, role: null };
}

export default async function CreateEventPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/strava/start?event=home");

  const { stravaId } = session;
  const { allowed, role } = await checkAccess(stravaId);

  if (!allowed) {
    return (
      <div style={{
        minHeight: "100dvh", background: "#0a0f1a", color: "#e2e8f0",
        fontFamily: "monospace", display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column", gap: "1rem",
      }}>
        <div style={{ fontSize: "1.5rem", color: "#f87171" }}>⊘</div>
        <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
          Acesso restrito a OWNER ou PROVIDER.
        </div>
      </div>
    );
  }

  const isProvider = role === "provider";

  return (
    <CreateCampForm
      stravaId={stravaId}
      isProvider={isProvider}
    />
  );
}
