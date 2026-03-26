// public/sw.js
//
// Service Worker — Triap PWA
//
// ─── RESPONSABILIDADES ────────────────────────────────────────────────────────
//
// 1. PUSH NOTIFICATIONS
//    Recebe eventos "push" do servidor (via Webpushr) e exibe a notificação
//    mesmo com o browser fechado. O Webpushr gerencia o próprio SW internamente,
//    mas este SW cobre o caso de push direto via Web Push API se necessário.
//
// 2. NOTIFICATIONCLICK
//    Quando o atleta clica na notificação, abre a URL correta no app.
//    Se o app já está aberto, foca a aba existente em vez de abrir uma nova.
//
// 3. CACHE OFFLINE (básico)
//    Cache de shell estático para experiência offline mínima.
//    O Webpushr registra seu próprio service worker (sw-server.min.js) para
//    gerenciar as assinaturas de push — os dois coexistem sem conflito pois
//    o Webpushr usa um escopo separado (/webpushr-sw/).
//
// ─── IMPORTANTE ───────────────────────────────────────────────────────────────
//
// O Webpushr registra o PRÓPRIO service worker automaticamente via SDK.
// Este arquivo (sw.js) é para funcionalidades adicionais do seu app PWA.
// Se você usar next-pwa ou workbox, este arquivo pode ser gerado automaticamente.

const CACHE_NAME = "triap-shell-v1";

// Arquivos do shell (ajuste conforme o build do Next.js)
const SHELL_ASSETS = ["/", "/offline.html"];

// ── Install: pré-cacheia o shell ─────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove caches antigos ──────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first para API, cache-first para assets ───────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API e autenticação → sempre rede (nunca cachear)
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Navegação → network-first, fallback para offline.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // Demais → cache-first
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

// ── Push: recebe notificações (complementar ao Webpushr SW) ──────────────────
//
// O Webpushr gerencia seu próprio SW para push. Este handler cobre notificações
// enviadas diretamente via Web Push API sem passar pelo Webpushr SDK.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Triap", body: event.data.text() };
  }

  const { title = "Triap", body = "", url = "/", icon = "/icons/icon-192.png" } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/icons/badge-72.png",
      data: { url },
      vibrate: [100, 50, 100],
    })
  );
});

// ── NotificationClick: abre ou foca a URL correta ────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Se já tem uma aba aberta com essa URL, foca ela
        const existing = clients.find((c) => c.url === targetUrl);
        if (existing) return existing.focus();

        // Se tem qualquer aba do app, navega para a URL
        const anyClient = clients.find((c) => c.url.startsWith(self.location.origin));
        if (anyClient) {
          anyClient.navigate(targetUrl);
          return anyClient.focus();
        }

        // Abre uma nova aba
        return self.clients.openWindow(targetUrl);
      })
  );
});
