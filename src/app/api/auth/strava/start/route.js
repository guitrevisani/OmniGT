// src/app/api/auth/strava/start/route.js
import { NextResponse } from "next/server";

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
    scope:           "read,activity:read_all,activity:write",
    state:           eventSlug,
  });

  return NextResponse.redirect(
    `https://www.strava.com/oauth/authorize?${params.toString()}`
  );
}
