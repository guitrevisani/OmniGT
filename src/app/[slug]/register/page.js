// src/app/[slug]/register/page.js
//
// Dispatcher de registro por módulo.
// Segue o mesmo padrão do dashboard/page.js.
//
// Para o Camp: renderiza o formulário de inscrição completo.
// Para o Agenda: renderiza o formulário atual (AgendaRegister).

import { redirect }    from "next/navigation";
import { query }       from "@/lib/db";
import { getSession }  from "@/lib/session";
import AgendaRegister  from "./AgendaRegister";
import CampRegister    from "./CampRegister";

export const runtime = "nodejs";

const MODULE_COMPONENTS = {
  agenda: AgendaRegister,
  camp:   CampRegister,
};

export default async function RegisterPage({ params, searchParams }) {
  const { slug } = await params;
  const sp       = await searchParams;

  const result = await query(
    `SELECT e.id, e.name, e.slug, m.slug AS module_slug
     FROM events e
     JOIN modules m ON m.id = e.module_id
     WHERE e.slug = $1 AND e.is_active = true`,
    [slug]
  );

  if (result.rows.length === 0) redirect("/");

  const event = result.rows[0];

  const Component = MODULE_COMPONENTS[event.module_slug];

  if (!Component) {
    return (
      <div style={{ padding: "2rem", fontFamily: "monospace" }}>
        Módulo <strong>{event.module_slug}</strong> não tem página de registro.
      </div>
    );
  }

  return (
    <Component
      slug={slug}
      eventId={event.id}
      eventName={event.name}
      searchParams={sp}
    />
  );
}
