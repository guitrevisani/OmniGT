// src/app/api/auth/strava/start/route.js
import { NextResponse } from "next/server";

/**
 * GET /api/auth/strava/start
 *
 * Inicia o fluxo OAuth com o Strava.
 * Redireciona para a página de autorização do Strava.
 *
 * Query params:
 *   event  → slug do evento (obrigatório, passado como state para o callback)
 *
 * Scope: "read,activity:read_all"
 *   - "read" é obrigatório pelo Strava (perfil básico)
 *   - "activity:read_all" cobre activity:read e dá acesso a atividades privadas
 *   - satisfaz o required_scopes de todos os módulos do sistema
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const eventSlug = searchParams.get("event");

  if (!eventSlug) {
    return NextResponse.json(
      { error: "Parâmetro 'event' ausente" },
      { status: 400 }
    );
  }

  const params = new URLSearchParams({
    client_id:       process.env.STRAVA_CLIENT_ID,
    redirect_uri:    process.env.STRAVA_REDIRECT_URI,
    response_type:   "code",
    approval_prompt: "auto",
    scope:           "read,activity:read_all",
    state:           eventSlug,
  });

  return NextResponse.redirect(
    `https://www.strava.com/oauth/authorize?${params.toString()}`
  );
}
