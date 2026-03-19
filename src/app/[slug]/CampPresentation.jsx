// src/app/[slug]/CampPresentation.jsx
//
// Server Component — apresentação pública do Camp.
// Todos os dados chegam via props do page.js.
// Não requer autenticação.

import styles from "./CampPresentation.module.css";

function formatDateRange(start, end) {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end   + "T12:00:00");
  const opts = { day: "numeric", month: "long" };
  const year = s.getFullYear();
  if (s.getMonth() === e.getMonth()) {
    return `${s.getDate()} – ${e.toLocaleDateString("pt-BR", opts)} de ${year}`;
  }
  return `${s.toLocaleDateString("pt-BR", opts)} – ${e.toLocaleDateString("pt-BR", opts)}, ${year}`;
}

function daysUntil(dateStr) {
  const today  = new Date();
  const target = new Date(dateStr + "T12:00:00");
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

export default function CampPresentation({
  slug,
  name,
  startDate,
  endDate,
  location   = null,
  objective  = null,
  websiteUrl = null,
  maxDays    = null,
}) {
  const dateRange = startDate && endDate ? formatDateRange(startDate, endDate) : null;
  const days      = startDate ? daysUntil(startDate) : null;
  const countdown = days != null && days > 0 ? days : null;

  return (
    <div className={styles.page}>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>

          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            OGT Camp
          </div>

          <h1 className={styles.heroTitle}>{name}</h1>

          <div className={styles.heroMeta}>
            {location && (
              <span className={styles.heroMetaItem}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                {location}
              </span>
            )}
            {dateRange && (
              <span className={styles.heroMetaItem}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8"  y1="2" x2="8"  y2="6"/>
                  <line x1="3"  y1="10" x2="21" y2="10"/>
                </svg>
                {dateRange}
              </span>
            )}
            {maxDays && (
              <span className={styles.heroMetaItem}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                {maxDays} dias
              </span>
            )}
          </div>

          {countdown && (
            <div className={styles.countdown}>
              <span className={styles.countdownValue}>{countdown}</span>
              <span className={styles.countdownLabel}>
                {countdown === 1 ? "dia para o início" : "dias para o início"}
              </span>
            </div>
          )}
        </div>

        <div className={styles.heroGradient} aria-hidden />
      </section>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className={styles.body}>

        {objective && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Sobre o camp</h2>
            <p className={styles.sectionText}>{objective}</p>
          </section>
        )}

        {websiteUrl && (
          <section className={styles.section}>
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
            >
              <span>Saiba mais sobre o evento</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </section>
        )}

        <section className={styles.cta}>
          <p className={styles.ctaText}>
            A inscrição é feita via Strava. Você será redirecionado para autorizar
            o acesso e preencher o formulário de inscrição.
          </p>
          <a
            href={`/api/auth/strava/start?event=${slug}`}
            className={styles.ctaButton}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
            </svg>
            Inscrever-se com Strava
          </a>
        </section>

        <footer className={styles.footer}>
          <span>OGT · Omni GT</span>
        </footer>

      </div>
    </div>
  );
}
