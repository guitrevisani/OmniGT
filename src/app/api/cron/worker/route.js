// src/app/api/cron/worker/route.js
//
// Chamada pelo Vercel Cron a cada minuto.
// Repassa para o strava-worker com o secret correto.
// O Vercel valida CRON_SECRET automaticamente em produção.

export const runtime = "nodejs";

export async function GET(request) {
  // Em produção o Vercel injeta e valida o header Authorization automaticamente.
  // Em desenvolvimento qualquer chamada passa.
  const base = process.env.INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;

  const res = await fetch(`${base}/api/internal/strava-worker`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${process.env.INTERNAL_WORKER_SECRET}` },
  });

  const data = await res.json();
  return Response.json({ ok: true, worker: data });
}
