// /src/app/api/auth/logout/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/auth/logout
 *
 * Invalida o token no banco e limpa o cookie de sessão.
 */
export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  await destroySession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", "", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   0,
  });

  return response;
}
