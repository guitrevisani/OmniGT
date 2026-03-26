import { NextResponse } from "next/server";

/**
 * ============================================================
 * MIDDLEWARE DE ACESSO
 * ============================================================
 *
 * /provider/*
 *   Acesso exclusivo do provider via cookie "provider_session".
 *
 * /api/internal/*
 *   Rotas internas protegidas por Bearer token.
 *
 * /events/*
 *   Página de criação/gestão de eventos (UI).
 *   Requer cookie "session" (Strava OAuth).
 *   Sem sessão → redirect para OAuth.
 *   A verificação de role (OWNER/PROVIDER) é feita na própria page.
 *
 * /api/events/create  →  NÃO está no middleware.
 *   É uma API route (só aceita POST). A proteção é feita internamente
 *   via getSession() + resolveCreatorRole(). Colocar no middleware
 *   causava 405 porque o redirect do middleware fazia um GET na rota.
 * ============================================================
 */

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // ── /api/internal/* ──────────────────────────────────────
  if (pathname.startsWith("/api/internal/")) {
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${process.env.INTERNAL_WORKER_SECRET}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // ── /provider/* ──────────────────────────────────────────
  if (pathname.startsWith("/provider")) {
    const secret = process.env.PROVIDER_SECRET;

    const keyParam = request.nextUrl.searchParams.get("key");
    if (keyParam) {
      if (keyParam !== secret) {
        return NextResponse.redirect(new URL("/", request.url));
      }
      const response = NextResponse.redirect(new URL("/provider", request.url));
      response.cookies.set("provider_session", secret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/provider",
        maxAge: 60 * 60 * 8,
      });
      return response;
    }

    const sessionCookie = request.cookies.get("provider_session")?.value;
    if (sessionCookie !== secret) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // ── /events/* (páginas UI) ────────────────────────────────
  // API routes em /api/events/* não passam aqui — protegidas internamente.
  if (pathname.startsWith("/events/")) {
    const sessionCookie = request.cookies.get("session")?.value;
    if (!sessionCookie) {
      const loginUrl = new URL("/api/auth/strava/start", request.url);
      loginUrl.searchParams.set("event", "home");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/provider/:path*",
    "/api/internal/:path*",
    "/events/:path*",
    // /api/events/create removido — API route só aceita POST,
    // middleware causava 405 ao tentar redirecionar via GET
  ],
};
