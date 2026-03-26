// src/app/api/push/send/route.js
//
// POST /api/push/send
//
// ─── O QUE ESTA ROTA FAZ ────────────────────────────────────────────────────
//
// Envia notificações push via Webpushr para diferentes escopos de destinatários.
// É sempre chamada server-to-server (pelo próprio backend), nunca exposta ao browser.
// Protegida pelo header Authorization: Bearer <INTERNAL_WORKER_SECRET>.
//
// ─── COMO FUNCIONA O ENVIO ──────────────────────────────────────────────────
//
// 1. O backend consulta notification_devices para resolver os SIDs (subscriber IDs)
//    correspondentes ao escopo solicitado (por strava_id, evento, módulo ou role).
//
// 2. Para cada SID encontrado, chama a API REST do Webpushr:
//    POST https://api.webpushr.com/v1/notification/send/sid
//    com headers: webpushrKey + webpushrAuthToken
//
// 3. Os envios são feitos em paralelo (Promise.allSettled) com batches de 20
//    para evitar rate limit do Webpushr.
//
// ─── ESCOPOS DE ENVIO ───────────────────────────────────────────────────────
//
// target: "individual"   → envia para um strava_id específico
//   requer: strava_id
//
// target: "event"        → envia para todos os atletas ativos de um evento
//   requer: event_id ou event_slug
//
// target: "event_role"   → envia para atletas de um evento com role específico
//   requer: event_id ou event_slug, role (owner/admin/user)
//
// target: "module"       → envia para todos os atletas de eventos de um módulo
//   requer: module_slug (ex: "camp", "agenda", "estimator")
//
// target: "all"          → envia para todos os devices com push_consent = true
//   (use com cuidado)
//
// ─── EXEMPLO DE PAYLOAD ─────────────────────────────────────────────────────
//
// {
//   "target":     "event",
//   "event_slug": "camp-serra-2025",
//   "title":      "Dia 2 começa amanhã!",
//   "message":    "Confira o percurso e prepare o equipamento.",
//   "target_url": "https://seuapp.com/camp-serra-2025/dashboard",
//   "icon":       "https://cdn.../icon.png",   // opcional 192x192 PNG HTTPS
//   "expire_push": "2d"                         // opcional, padrão: 4 semanas
// }

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";

export const runtime = "nodejs";

const WEBPUSHR_ENDPOINT = "https://api.webpushr.com/v1/notification/send/sid";
const BATCH_SIZE = 20; // Webpushr recomenda não exceder muitas req simultâneas

// ── Guard: apenas chamadas internas ──────────────────────────────────────────

function isAuthorized(request) {
  const header = request.headers.get("authorization");
  return header === `Bearer ${process.env.INTERNAL_WORKER_SECRET}`;
}

// ── Resolve SIDs a partir do escopo ─────────────────────────────────────────
//
// Retorna array de { strava_id, player_id (= SID) }
// Filtra apenas atletas com push_consent = true no evento correspondente.

async function resolveSids(target, params) {

  // ── individual: um atleta específico
  if (target === "individual") {
    if (!params.strava_id) throw new Error("strava_id é obrigatório para target=individual");

    const result = await query(
      `SELECT nd.strava_id, nd.player_id
       FROM notification_devices nd
       WHERE nd.strava_id = $1`,
      [params.strava_id]
    );
    return result.rows;
  }

  // ── event: todos os atletas ativos de um evento com push_consent
  if (target === "event") {
    if (!params.event_id && !params.event_slug)
      throw new Error("event_id ou event_slug é obrigatório para target=event");

    const result = await query(
      `SELECT nd.strava_id, nd.player_id
       FROM notification_devices nd
       JOIN athlete_events ae ON ae.strava_id = nd.strava_id
       JOIN events e          ON e.id = ae.event_id
       WHERE (e.id = $1 OR e.slug = $2)
         AND ae.status      = 'active'
         AND ae.push_consent = true
         AND e.is_active    = true`,
      [params.event_id || null, params.event_slug || null]
    );
    return result.rows;
  }

  // ── event_role: atletas de um evento com role específico
  if (target === "event_role") {
    if (!params.event_id && !params.event_slug)
      throw new Error("event_id ou event_slug é obrigatório para target=event_role");
    if (!params.role)
      throw new Error("role é obrigatório para target=event_role");

    const result = await query(
      `SELECT nd.strava_id, nd.player_id
       FROM notification_devices nd
       JOIN athlete_events ae ON ae.strava_id = nd.strava_id
       JOIN events e          ON e.id = ae.event_id
       WHERE (e.id = $1 OR e.slug = $2)
         AND ae.role        = $3
         AND ae.status      = 'active'
         AND ae.push_consent = true
         AND e.is_active    = true`,
      [params.event_id || null, params.event_slug || null, params.role]
    );
    return result.rows;
  }

  // ── module: todos os atletas de eventos de um módulo específico
  if (target === "module") {
    if (!params.module_slug)
      throw new Error("module_slug é obrigatório para target=module");

    const result = await query(
      `SELECT DISTINCT nd.strava_id, nd.player_id
       FROM notification_devices nd
       JOIN athlete_events ae ON ae.strava_id = nd.strava_id
       JOIN events e          ON e.id = ae.event_id
       JOIN modules m         ON m.id = e.module_id
       WHERE m.slug          = $1
         AND ae.status       = 'active'
         AND ae.push_consent = true
         AND e.is_active     = true`,
      [params.module_slug]
    );
    return result.rows;
  }

  // ── all: todos os devices (push_consent implícito na inscrição)
  if (target === "all") {
    const result = await query(
      `SELECT DISTINCT nd.strava_id, nd.player_id
       FROM notification_devices nd
       JOIN athlete_events ae ON ae.strava_id = nd.strava_id
       WHERE ae.push_consent = true
         AND ae.status       = 'active'`
    );
    return result.rows;
  }

  throw new Error(`target inválido: ${target}`);
}

// ── Envia para um SID via Webpushr REST API ──────────────────────────────────

async function sendToSid(sid, notification) {
  const res = await fetch(WEBPUSHR_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "webpushrKey":       process.env.WEBPUSHR_KEY,
      "webpushrAuthToken": process.env.WEBPUSHR_AUTH_TOKEN,
    },
    body: JSON.stringify({
      sid,
      title:      notification.title,
      message:    notification.message,
      target_url: notification.target_url,
      ...(notification.icon        && { icon: notification.icon }),
      ...(notification.expire_push && { expire_push: notification.expire_push }),
      ...(notification.auto_hide   !== undefined && { auto_hide: notification.auto_hide }),
    }),
  });

  const data = await res.json().catch(() => ({}));
  return { sid, ok: data.status === "success", response: data };
}

// ── Envia em batches para respeitar rate limit ───────────────────────────────

async function sendBatched(sids, notification) {
  const results = [];

  for (let i = 0; i < sids.length; i += BATCH_SIZE) {
    const batch = sids.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(sid => sendToSid(sid, notification))
    );

    for (const item of settled) {
      if (item.status === "fulfilled") {
        results.push(item.value);
      } else {
        results.push({ sid: "unknown", ok: false, error: item.reason?.message });
      }
    }

    // Pequena pausa entre batches para evitar rate limit
    if (i + BATCH_SIZE < sids.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request) {

  // 1. Proteção: apenas chamadas internas com INTERNAL_WORKER_SECRET
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const {
    target,
    title,
    message,
    target_url,
    icon,
    expire_push,
    auto_hide,
    // Params de escopo
    strava_id,
    event_id,
    event_slug,
    role,
    module_slug,
  } = body;

  // 3. Validação básica
  if (!target)     return NextResponse.json({ error: "target é obrigatório" }, { status: 400 });
  if (!title)      return NextResponse.json({ error: "title é obrigatório" }, { status: 400 });
  if (!message)    return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });
  if (!target_url) return NextResponse.json({ error: "target_url é obrigatório" }, { status: 400 });

  // 4. Resolve SIDs a partir do BD
  let rows;
  try {
    rows = await resolveSids(target, { strava_id, event_id, event_slug, role, module_slug });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      message: "Nenhum subscriber encontrado para este escopo.",
    });
  }

  // 5. Extrai apenas os SIDs (player_id = subscriber_id no Webpushr)
  const sids = rows.map(r => r.player_id);

  // 6. Dispara os envios em batches
  const notification = { title, message, target_url, icon, expire_push, auto_hide };
  const results = await sendBatched(sids, notification);

  // 7. Contabiliza
  const succeeded = results.filter(r => r.ok).length;
  const failed    = results.filter(r => !r.ok);

  console.log(
    `[push/send] target=${target} | found=${rows.length} | sent=${succeeded} | failed=${failed.length}`
  );

  if (failed.length > 0) {
    console.warn("[push/send] Falhas:", failed.slice(0, 5)); // log só as primeiras 5
  }

  return NextResponse.json({
    ok:        true,
    target,
    found:     rows.length,
    sent:      succeeded,
    failed:    failed.length,
    // Inclui detalhes de falha apenas para debug (remover em produção se sensível)
    failures:  failed.length > 0 ? failed : undefined,
  });
}
