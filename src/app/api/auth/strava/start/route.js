import { NextResponse } from "next/server";

/**
 * GET /api/auth/strava/start
 *
 * Inicia o fluxo OAuth com o Strava.
 * Redireciona para a página de autorização do Strava.
 *
 * Query params:
 *   event  → slug do evento (obrigatório, passado como state para o callback)
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
    client_id:     process.env.STRAVA_CLIENT_ID,
    redirect_uri:  process.env.STRAVA_REDIRECT_URI,
    response_type: "code",
    approval_prompt: "auto",
    scope:         "activity:read,activity:write",
    state:         eventSlug,
  });

  const stravaAuthUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;

  return NextResponse.redirect(stravaAuthUrl);
}
