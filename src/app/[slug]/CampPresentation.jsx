"use client";

// src/app/[slug]/CampPresentation.jsx
//
// Tela de entrada do camp:
//   · Saudação pelo firstname (vem de ?name= injetado pelo callback)
//   · Descrição do evento (metadata.description)
//   · CTA condicional: membro → formulário | não-membro → modal clube
//
// É Client Component porque lê useSearchParams().

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import styles from "./CampPresentation.module.css";

const STRAVA_CLUB_URL    = "https://www.strava.com/clubs/1032654";
const STRAVA_CLUB_DEEPLINK = "strava://clubs/1032654";

// ── Modal "não membro" ────────────────────────────────────────────────────────

function NonMemberModal({ onClose }) {
  function handleJoin() {
    // Tenta abrir o app Strava no mobile; fallback para web
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      // Deep link tenta abrir o app; se falhar em 1.5s abre a web
      const timer = setTimeout(() => {
        window.open(STRAVA_CLUB_URL, "_blank", "noopener,noreferrer");
      }, 1500);
      window.location.href = STRAVA_CLUB_DEEPLINK;
      // Cancela o fallback se o app abriu (página perde foco)
      window.addEventListener("blur", () => clearTimeout(timer), { once: true });
    } else {
      window.open(STRAVA_CLUB_URL, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,.6)",
        zIndex: 99999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem", boxSizing: "border-box",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: "16px",
        padding: "2rem", width: "min(440px,100%)",
        boxShadow: "0 12px 40px rgba(0,0,0,.2)",
        boxSizing: "border-box",
      }}>
        <h3 style={{ margin: "0 0 1rem", fontSize: "1.15rem", color: "#0b1a3b" }}>
          Inscrição exclusiva para membros
        </h3>
        <p style={{ margin: "0 0 1.5rem", fontSize: ".95rem", lineHeight: 1.6, color: "#444" }}>
          O Jordan Camp é reservado aos membros do clube{" "}
          <strong>Jordan Cycling</strong> no Strava. Entre no clube e volte
          aqui para confirmar a sua inscrição.
        </p>
        <div style={{ display: "flex", gap: ".75rem", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: ".6rem 1.2rem", borderRadius: "8px",
              border: "1px solid #ccc", background: "transparent",
              cursor: "pointer", fontSize: ".9rem",
            }}
          >
            Fechar
          </button>
          <button
            onClick={handleJoin}
            style={{
              padding: ".6rem 1.4rem", borderRadius: "8px",
              background: "#fc4c02", color: "#fff",
              border: "none", cursor: "pointer",
              fontSize: ".9rem", fontWeight: 600,
            }}
          >
            Entrar no clube Strava →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bloco de CTA condicional ──────────────────────────────────────────────────

function CtaBlock({ slug, registerUrl }) {
  const searchParams = useSearchParams();
  const memberParam  = searchParams.get("member"); // "1" | "0" | null
  const firstName    = searchParams.get("name")   || "";

  const [showModal, setShowModal] = useState(false);

  // Ainda não autenticou
  if (memberParam === null) {
    return (
      <div className={styles.cta}>
        <p className={styles.ctaText}>
          Para se inscrever, conecte sua conta Strava. O processo leva menos
          de 1 minuto.
        </p>
        <a
          href={`/api/auth/strava/start?event=${slug}`}
          className={styles.ctaButton}
        >
          <StravaIcon />
          Conectar com Strava
        </a>
      </div>
    );
  }

  // Autenticado — monta saudação
  const greeting = firstName
    ? `Olá, ${firstName}! Que bom ter você aqui.`
    : "Bem-vindo!";

  // Membro → link para formulário de inscrição
  if (memberParam === "1") {
    return (
      <div className={styles.cta}>
        <p className={styles.ctaText}>{greeting}</p>
        <p className={styles.ctaText}>
          Sua conta Strava está conectada e confirmamos que você é membro do
          clube Jordan Cycling. Complete o formulário abaixo para garantir
          sua vaga.
        </p>
        <a href={registerUrl} className={styles.ctaButton}>
          Preencher formulário de inscrição →
        </a>
      </div>
    );
  }

  // Não membro → CTA modal
  return (
    <>
      {showModal && <NonMemberModal onClose={() => setShowModal(false)} />}
      <div className={styles.cta}>
        <p className={styles.ctaText}>{greeting}</p>
        <p className={styles.ctaText}>
          Identificamos que você ainda não é membro do clube Jordan Cycling
          no Strava. A inscrição é exclusiva para membros do clube.
        </p>
        <button
          className={styles.ctaButton}
          onClick={() => setShowModal(true)}
        >
          Como entrar no clube →
        </button>
      </div>
    </>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CampPresentation({
  slug,
  name,
  startDate,
  endDate,
  location,
  description,
  websiteUrl,
  maxDays,
}) {
  const daysUntil = startDate
    ? Math.max(0, Math.ceil((new Date(startDate) - new Date()) / 86400000))
    : null;

  return (
    <div className={styles.page}>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroGradient} />
        <div className={styles.heroInner}>

          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Jordan Camp 2026
          </div>

          <h1 className={styles.heroTitle}>{name}</h1>

          <div className={styles.heroMeta}>
            {location && (
              <span className={styles.heroMetaItem}>
                <PinIcon /> {location}
              </span>
            )}
            {startDate && endDate && (
              <span className={styles.heroMetaItem}>
                <CalIcon /> {fmtDate(startDate)} → {fmtDate(endDate)}
              </span>
            )}
            {maxDays && (
              <span className={styles.heroMetaItem}>
                <DaysIcon /> {maxDays} dias de programa
              </span>
            )}
          </div>

          {daysUntil !== null && (
            <div className={styles.countdown}>
              <span className={styles.countdownValue}>{daysUntil}</span>
              <span className={styles.countdownLabel}>dias para o camp</span>
            </div>
          )}

        </div>
      </section>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className={styles.body}>

        {description && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Sobre o evento</h2>
            <p className={styles.sectionText}>{description}</p>
          </section>
        )}

        {websiteUrl && (
          <section className={styles.section}>
            <a
              href={websiteUrl}
              className={styles.externalLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Saiba mais ↗
            </a>
          </section>
        )}

        {/* CTA — lê ?member e ?name da URL */}
        <Suspense fallback={null}>
          <CtaBlock
            slug={slug}
            registerUrl={`/${slug}/register`}
          />
        </Suspense>

        <p className={styles.footer}>
          Powered by OGT · dados protegidos conforme LGPD
        </p>

      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function StravaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.599h4.172L10.463 0 4 13.828h4.172" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function CalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function DaysIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}
