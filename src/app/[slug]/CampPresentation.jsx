"use client";

// src/app/[slug]/CampPresentation.jsx
//
// Apresentação do camp. Lê ?member=1|0 da URL (injetado pelo callback)
// para decidir entre:
//   - Botão de pagamento   → atleta é membro do clube Strava exigido
//   - CTA "entrar no clube" → atleta NÃO é membro
//   - Botão "conectar Strava" → atleta ainda não autenticou (sem ?member)

import { useSearchParams } from "next/navigation";
import { Suspense }        from "react";

const STRAVA_CLUB_URL = "https://www.strava.com/clubs/1032654";

// Recebido de page.js via event_configs.metadata.payment_url
// Passado como prop para desacoplar do componente
function CtaBlock({ slug, paymentUrl }) {
  const searchParams = useSearchParams();
  const memberParam  = searchParams.get("member"); // "1" | "0" | null

  // Ainda não passou pelo OAuth
  if (memberParam === null) {
    return (
      <a
        href={`/api/auth/strava/start?event=${slug}`}
        className="btn btn-strava"
      >
        Conectar com Strava
      </a>
    );
  }

  // Autenticado e é membro do clube → link de pagamento
  if (memberParam === "1") {
    return (
      <a
        href={paymentUrl || "#"}
        className="btn btn-primary"
        target="_blank"
        rel="noopener noreferrer"
      >
        Confirmar inscrição
      </a>
    );
  }

  // Autenticado mas NÃO é membro → CTA do clube
  return (
    <div className="cta-club">
      <p className="cta-club__msg">
        A inscrição no Jordan Camp é exclusiva para membros do clube Strava
        Jordan Cycling. Entre no clube para liberar a confirmação.
      </p>
      <a
        href={STRAVA_CLUB_URL}
        className="btn btn-club"
        target="_blank"
        rel="noopener noreferrer"
      >
        Entrar no clube Strava
      </a>
    </div>
  );
}

export default function CampPresentation({
  slug,
  name,
  startDate,
  endDate,
  location,
  objective,
  websiteUrl,
  maxDays,
  paymentUrl,   // event_configs.metadata.payment_url
}) {
  return (
    <section className="camp-presentation">
      <h1 className="camp-presentation__title">{name}</h1>

      {location && (
        <p className="camp-presentation__location">{location}</p>
      )}

      {(startDate || endDate) && (
        <p className="camp-presentation__dates">
          {startDate} {endDate && endDate !== startDate ? `→ ${endDate}` : ""}
        </p>
      )}

      {maxDays && (
        <p className="camp-presentation__days">{maxDays} dias de programa</p>
      )}

      {objective && (
        <p className="camp-presentation__objective">{objective}</p>
      )}

      {websiteUrl && (
        <a
          href={websiteUrl}
          className="camp-presentation__website"
          target="_blank"
          rel="noopener noreferrer"
        >
          Saiba mais
        </a>
      )}

      <div className="camp-presentation__cta">
        {/* useSearchParams exige Suspense quando está num Server Component pai */}
        <Suspense fallback={null}>
          <CtaBlock slug={slug} paymentUrl={paymentUrl} />
        </Suspense>
      </div>
    </section>
  );
}
