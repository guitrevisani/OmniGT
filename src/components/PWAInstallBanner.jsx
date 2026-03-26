"use client";

// src/components/PWAInstallBanner.jsx
//
// ─── O QUE É ──────────────────────────────────────────────────────────────────
//
// Banner de instalação PWA unificado para iOS e Android.
//
// ─── COMO CADA PLATAFORMA FUNCIONA ───────────────────────────────────────────
//
// ANDROID (Chrome, Edge, Samsung Internet):
//   O browser emite o evento `beforeinstallprompt` quando o app é instalável.
//   Capturamos esse evento, impedimos o prompt nativo automático, e exibimos
//   nosso banner customizado. Quando o usuário aceita, chamamos prompt() no
//   evento capturado — o browser faz o resto. É limpo e nativo.
//   Condições para o Chrome emitir o evento:
//     - HTTPS
//     - manifest.json com name, start_url, icons (192 e 512)
//     - display: standalone
//     - Service worker registrado
//     - App ainda não instalado
//
// iOS (Safari):
//   Não existe `beforeinstallprompt`. A instalação é sempre manual:
//   Safari → botão Compartilhar → "Adicionar à Tela de Início".
//   Exibimos um banner explicativo com os 3 passos e uma seta apontando
//   para o botão de compartilhamento na barra inferior do Safari.
//   Push web no iOS SÓ funciona com o app instalado como PWA.
//
// ─── LÓGICA DE EXIBIÇÃO ──────────────────────────────────────────────────────
//
//  1. Se já está em modo standalone → não exibe nada (já instalado)
//  2. Se Android + beforeinstallprompt capturado → exibe banner Android
//  3. Se iOS + Safari → exibe banner iOS após 2.5s
//  4. Se dispensado → suprime por DISMISS_DAYS dias (localStorage)
//  5. Se instalado com sucesso (Android) → suprime permanentemente

import { useState, useEffect, useRef } from "react";

// ── Detecção de plataforma ────────────────────────────────────────────────────

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function isSafariBrowser() {
  if (typeof navigator === "undefined") return false;
  return /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);
}

// ── Persistência de dismiss ───────────────────────────────────────────────────

const DISMISSED_KEY  = "pwa_banner_dismissed_at";
const INSTALLED_KEY  = "pwa_installed";
const DISMISS_DAYS   = 30;

function wasDismissedRecently() {
  try {
    if (localStorage.getItem(INSTALLED_KEY)) return true;
    const ts = localStorage.getItem(DISMISSED_KEY);
    if (!ts) return false;
    return Date.now() - parseInt(ts, 10) < DISMISS_DAYS * 86400000;
  } catch { return false; }
}

function saveDismiss() {
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch {}
}

function saveInstalled() {
  try { localStorage.setItem(INSTALLED_KEY, "1"); } catch {}
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  bg:      "#1e293b",
  border:  "#334155",
  text:    "#e2e8f0",
  muted:   "#94a3b8",
  dim:     "#64748b",
  accent:  "#3b82f6",
  surface: "#0f172a",
  ok:      "#22c55e",
};

const S = {
  overlay: {
    position:      "fixed",
    bottom:        0,
    left:          0,
    right:         0,
    zIndex:        9999,
    padding:       "0 0.75rem",
    paddingBottom: "calc(0.85rem + env(safe-area-inset-bottom))",
    pointerEvents: "none",
  },
  card: {
    background:    C.bg,
    borderRadius:  "1rem",
    border:        `1px solid ${C.border}`,
    boxShadow:     "0 -8px 40px rgba(0,0,0,0.6)",
    padding:       "1.1rem 1rem 1rem",
    pointerEvents: "all",
    position:      "relative",
    fontFamily:    "system-ui, sans-serif",
    animation:     "pwaSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)",
  },
  closeBtn: {
    position:   "absolute",
    top:        "0.75rem",
    right:      "0.85rem",
    background: "none",
    border:     "none",
    color:      C.dim,
    fontSize:   "1rem",
    cursor:     "pointer",
    padding:    "0.2rem 0.4rem",
    lineHeight: 1,
  },
  header: {
    display:       "flex",
    alignItems:    "center",
    gap:           "0.75rem",
    marginBottom:  "0.9rem",
    paddingRight:  "1.5rem",
  },
  appIcon: {
    width:          "3rem",
    height:         "3rem",
    borderRadius:   "0.65rem",
    background:     C.surface,
    border:         `1px solid ${C.border}`,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    fontSize:       "1.4rem",
    flexShrink:     0,
  },
  titleBlock: { flex: 1 },
  title: {
    fontSize:   "0.92rem",
    fontWeight: 700,
    color:      "#f1f5f9",
    margin:     "0 0 0.15rem",
  },
  subtitle: {
    fontSize:   "0.75rem",
    color:      C.muted,
    margin:     0,
    lineHeight: 1.4,
  },
  divider: {
    borderTop: `1px solid ${C.border}`,
    margin:    "0 0 0.85rem",
  },
  // Android: botão de instalação
  installBtn: {
    width:        "100%",
    background:   C.accent,
    border:       "none",
    borderRadius: "0.6rem",
    color:        "#fff",
    cursor:       "pointer",
    fontSize:     "0.88rem",
    fontWeight:   700,
    fontFamily:   "inherit",
    padding:      "0.75rem",
    letterSpacing:"0.02em",
    display:      "flex",
    alignItems:   "center",
    justifyContent:"center",
    gap:          "0.5rem",
    transition:   "background 0.15s",
  },
  notNow: {
    display:    "block",
    textAlign:  "center",
    marginTop:  "0.6rem",
    fontSize:   "0.75rem",
    color:      C.dim,
    cursor:     "pointer",
    padding:    "0.3rem",
    background: "none",
    border:     "none",
    width:      "100%",
    fontFamily: "inherit",
  },
  // iOS: passos manuais
  steps: {
    display:       "flex",
    flexDirection: "column",
    gap:           "0.55rem",
    marginBottom:  "0.75rem",
  },
  step: {
    display:    "flex",
    alignItems: "center",
    gap:        "0.65rem",
    fontSize:   "0.8rem",
    color:      C.text,
    lineHeight: 1.35,
  },
  stepNum: {
    width:          "1.4rem",
    height:         "1.4rem",
    borderRadius:   "50%",
    background:     C.surface,
    border:         `1px solid ${C.border}`,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    fontSize:       "0.65rem",
    fontWeight:     700,
    color:          C.accent,
    flexShrink:     0,
  },
  arrowWrap: {
    display:        "flex",
    justifyContent: "center",
    paddingTop:     "0.25rem",
  },
  arrowSvg: {
    width:     "1.4rem",
    color:     C.accent,
    animation: "pwaBounce 1.5s infinite",
  },
};

const CSS = `
  @keyframes pwaSlideUp {
    from { transform: translateY(110%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  @keyframes pwaBounce {
    0%,100% { transform: translateY(0); }
    50%     { transform: translateY(5px); }
  }
`;

// ── Ícone compartilhar do Safari ──────────────────────────────────────────────

function ShareIcon({ size = "1em" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ width: size, height: size, verticalAlign: "middle", display: "inline-block" }}>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

// ── Ícone download ────────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ width: "1.1em", height: "1.1em" }}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ── Banner iOS ────────────────────────────────────────────────────────────────

function IOSBanner({ onDismiss }) {
  return (
    <>
      <div style={S.header}>
        <div style={S.appIcon}>🏔️</div>
        <div style={S.titleBlock}>
          <p style={S.title}>Instale o Triap</p>
          <p style={S.subtitle}>Necessário para receber notificações dos seus eventos</p>
        </div>
      </div>

      <div style={S.divider} />

      <div style={S.steps}>
        <div style={S.step}>
          <div style={S.stepNum}>1</div>
          <span>
            Toque em <ShareIcon size="1.1em" />{" "}
            <strong style={{ color: C.accent }}>Compartilhar</strong> na barra do Safari
          </span>
        </div>
        <div style={S.step}>
          <div style={S.stepNum}>2</div>
          <span>Selecione <strong style={{ color: "#f1f5f9" }}>"Adicionar à Tela de Início"</strong></span>
        </div>
        <div style={S.step}>
          <div style={S.stepNum}>3</div>
          <span>Toque em <strong style={{ color: "#f1f5f9" }}>"Adicionar"</strong> e abra o Triap pela tela inicial</span>
        </div>
      </div>

      {/* Seta apontando para o botão de compartilhar (barra inferior Safari) */}
      <div style={S.arrowWrap}>
        <svg style={S.arrowSvg} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>

      <button style={S.notNow} onClick={onDismiss}>Agora não</button>
    </>
  );
}

// ── Banner Android ────────────────────────────────────────────────────────────

function AndroidBanner({ onInstall, onDismiss }) {
  return (
    <>
      <div style={S.header}>
        <div style={S.appIcon}>🏔️</div>
        <div style={S.titleBlock}>
          <p style={S.title}>Adicionar à tela inicial</p>
          <p style={S.subtitle}>
            Acesso rápido e notificações dos seus eventos, sem precisar abrir o browser
          </p>
        </div>
      </div>

      <div style={S.divider} />

      <button style={S.installBtn} onClick={onInstall}>
        <DownloadIcon />
        Instalar o Triap
      </button>

      <button style={S.notNow} onClick={onDismiss}>Agora não</button>
    </>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function PWAInstallBanner() {
  const [platform, setPlatform]       = useState(null); // "ios" | "android" | null
  const [visible, setVisible]         = useState(false);
  const deferredPrompt                = useRef(null);

  useEffect(() => {
    // Já instalado ou dispensado recentemente → sai
    if (isStandalone() || wasDismissedRecently()) return;

    // ── Android: captura o evento beforeinstallprompt ─────────────────────
    if (isAndroid()) {
      const handler = (e) => {
        e.preventDefault();             // impede o mini-infobar automático do Chrome
        deferredPrompt.current = e;
        setPlatform("android");
        setVisible(true);
      };
      window.addEventListener("beforeinstallprompt", handler);

      // Detecta instalação bem-sucedida
      window.addEventListener("appinstalled", () => {
        saveInstalled();
        setVisible(false);
      });

      return () => window.removeEventListener("beforeinstallprompt", handler);
    }

    // ── iOS: exibe banner explicativo após delay ───────────────────────────
    if (isIOS() && isSafariBrowser()) {
      const t = setTimeout(() => {
        setPlatform("ios");
        setVisible(true);
      }, 2500);
      return () => clearTimeout(t);
    }
  }, []);

  async function handleInstall() {
    if (!deferredPrompt.current) return;
    deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    deferredPrompt.current = null;
    if (outcome === "accepted") {
      saveInstalled();
    } else {
      saveDismiss();
    }
    setVisible(false);
  }

  function handleDismiss() {
    saveDismiss();
    setVisible(false);
  }

  if (!visible || !platform) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={S.overlay} role="dialog" aria-modal="true"
        aria-label="Instalar aplicativo">
        <div style={S.card}>
          <button style={S.closeBtn} onClick={handleDismiss} aria-label="Fechar">✕</button>

          {platform === "ios" && (
            <IOSBanner onDismiss={handleDismiss} />
          )}
          {platform === "android" && (
            <AndroidBanner onInstall={handleInstall} onDismiss={handleDismiss} />
          )}
        </div>
      </div>
    </>
  );
}
