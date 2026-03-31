// src/app/layout.js
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PWAInstallBanner from "@/components/PWAInstallBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: {
    default: "OmniGT",
    template: "OGT - %s",
  },
  description: "OGT Event Engine",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "OmniGT",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  themeColor:   "#0f172a",
  width:        "device-width",
  initialScale: 1,
  viewportFit:  "cover",   // safe-area no notch do iPhone
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <meta name="robots" content="noindex,nofollow" />
      <link rel="icon" href="/favicon.png" />

      {/* ── Ícones Apple (PWA — "Adicionar à Tela de Início" no iOS) ── */}
      <link rel="apple-touch-icon" href="/icon-192.png" />
      <link rel="apple-touch-icon" sizes="152x152" href="/icon-152.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />

      <body className={`${geistSans.variable} ${geistMono.variable}`}>

        {children}

        {/* ── PWA Install Banner ─────────────────────────────────────────
            Client component. Detecta plataforma:
            - Android → botão nativo via beforeinstallprompt
            - iOS/Safari → instruções manuais (Compartilhar → Add to Home)
            Suprimido por 30 dias após o usuário dispensar. ─────────── */}
        <PWAInstallBanner />

        {/* ── Webpushr SDK ───────────────────────────────────────────────
            Posição: footer — instrução oficial da documentação Webpushr.
            app.min.js é o arquivo correto para sites HTTPS.

            _webpushrScriptReady() é disparada automaticamente pelo SDK.
            Fluxo:
              1. GET /api/push/init → atributos do atleta autenticado
                 (strava_id, event_*, role_*, module_*)
              2. webpushr('attributes', ...) → segmentação no Webpushr
              3. webpushr('fetch_id', ...) → obtém SID do browser
              4. POST /api/push/register → persiste SID ↔ strava_id no BD

            Se não autenticado, /api/push/init retorna { attributes: {} }
            e o fluxo termina silenciosamente. ──────────────────────── */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(w,d,s,id){
                if(typeof(w.webpushr)!=='undefined') return;
                w.webpushr=w.webpushr||function(){(w.webpushr.q=w.webpushr.q||[]).push(arguments)};
                var js,fjs=d.getElementsByTagName(s)[0];
                js=d.createElement(s);js.id=id;js.async=1;
                js.src='https://cdn.webpushr.com/app.min.js';
                fjs.parentNode.appendChild(js);
              }(window,document,'script','webpushr-jssdk'));

              webpushr('setup',{'key':'BB7kiF86j38U4j5hRRE7EzCIf665X_E8Pmxw1j-qcSrbQqUxbL-goTpXgIlUK1omtL9csrlo2AGULOd9ZMqOTKo'});

              function _webpushrScriptReady(){
                fetch('/api/push/init')
                  .then(function(r){ return r.ok ? r.json() : null; })
                  .then(function(data){
                    if(!data) return;
                    if(data.attributes && Object.keys(data.attributes).length > 0){
                      webpushr('attributes', data.attributes);
                    }
                    webpushr('fetch_id', function(sid){
                      if(!sid) return;
                      fetch('/api/push/register',{
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({
                          subscriber_id: sid,
                          platform: /iphone|ipad|ipod/i.test(navigator.userAgent)
                            ? 'ios'
                            : /android/i.test(navigator.userAgent)
                              ? 'android'
                              : 'web'
                        })
                      }).catch(function(){});
                    });
                  })
                  .catch(function(){});
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
