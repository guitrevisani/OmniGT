import { NextResponse } from "next/server";

/**
 * ============================================================
 * MIDDLEWARE DE ACESSO
 * ============================================================
 *
 * Rotas protegidas:
 *
 * /provider/*
 *   Acesso exclusivo do provider.
 *   Autenticado por cookie "provider_session" cujo valor deve
 *   bater com PROVIDER_SECRET (variável server-side apenas).
 *   Acesso inicial via GET /provider?key=<PROVIDER_SECRET>,
 *   que define o cookie e redireciona para /provider.
 *
 * /api/internal/*
 *   Rotas internas da engine (worker, validate-access, role).
 *   Protegidas por header Authorization: Bearer <INTERNAL_WORKER_SECRET>.
 *   Chamadas apenas server-to-server — nunca expostas ao browser.
 *
 * /events/*  e  /api/events/create
 *   Criação e gestão de eventos por OWNER ou PROVIDER.
 *   Requer cookie de sessão Strava válido ("session").
 *   A verificação de role (OWNER/PROVIDER) é feita na própria
 *   page/API — o middleware só garante que há uma sessão ativa.
 *   Sem sessão → redirect para /api/auth/strava/start?event=home
 *
 * Rotas públicas (sem proteção aqui):
 *   /                     landing page
 *   /[slug]               página do evento
 *   /[slug]/register      inscrição no evento
 *   /api/auth/strava/*    fluxo OAuth
 *   /api/stravaWebhook    recebimento de webhooks do Strava
 *   /api/events           listagem pública de eventos (GET)
 * ============================================================
 */

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // ── /api/internal/* ──────────────────────────────────────
  if (pathname.startsWith("/api/internal/")) {
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${process.env.INTERNAL_WORKER_SECRET}`;

    if (authHeader !== expected) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.next();
  }

  // ── /provider/* ──────────────────────────────────────────
  if (pathname.startsWith("/provider")) {
    const secret = process.env.PROVIDER_SECRET;

    // Primeiro acesso via query param → define cookie e redireciona
    const keyParam = request.nextUrl.searchParams.get("key");
    if (keyParam) {
      if (keyParam !== secret) {
        return NextResponse.redirect(new URL("/", request.url));
      }

      const response = NextResponse.redirect(
        new URL("/provider", request.url)
      );
      response.cookies.set("provider_session", secret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/provider",
        maxAge: 60 * 60 * 8, // 8 horas
      });
      return response;
    }

    // Acessos subsequentes → valida cookie
    const sessionCookie = request.cookies.get("provider_session")?.value;
    if (sessionCookie !== secret) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  // ── /events/* e /api/events/create ───────────────────────
  // Requer sessão Strava ativa (role check feito na route/page)
  const isEventsPage = pathname.startsWith("/events/");
  const isEventsCreateApi = pathname === "/api/events/create";

  if (isEventsPage || isEventsCreateApi) {
    const sessionCookie = request.cookies.get("session")?.value;

    if (!sessionCookie) {
      // Sem sessão → inicia OAuth (state "home" para redirecionar depois)
      const loginUrl = new URL("/api/auth/strava/start", request.url);
      loginUrl.searchParams.set("event", "home");
      return NextResponse.redirect(loginUrl);
    }

    // Sessão presente — role check será feito na page/API
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/provider/:path*",
    "/api/internal/:path*",
    "/events/:path*",
    "/api/events/create",
  ],
};
