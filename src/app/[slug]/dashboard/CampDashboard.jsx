// src/app/[slug]/dashboard/CampDashboard.jsx
"use client";

import { useState, useEffect } from "react";

function fmtKm(m)   { return Math.floor(m / 1000) + " km"; }
function fmtElev(m) { return Math.round(m).toLocaleString("pt-BR") + " m"; }
function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}min`;
}

const S = {
  page:       { minHeight: "100dvh", background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", padding: "1.5rem 1rem" },
  header:     { marginBottom: "1.5rem" },
  title:      { fontSize: "1.25rem", fontWeight: 700, color: "#f8fafc", margin: 0 },
  subtitle:   { fontSize: "0.85rem", color: "#94a3b8", marginTop: "0.25rem" },
  section:    { marginBottom: "1.5rem" },
  sTitle:     { fontSize: "0.85rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" },
  grid:       { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.75rem" },
  card:       { background: "#1e293b", borderRadius: "0.75rem", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.25rem" },
  cardLabel:  { fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" },
  cardValue:  { fontSize: "1.4rem", fontWeight: 700, color: "#f8fafc" },
  cardSub:    { fontSize: "0.75rem", color: "#94a3b8" },
  sessCard:   { background: "#1e293b", borderRadius: "0.75rem", padding: "0.875rem 1rem", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" },
  sessLeft:   { display: "flex", flexDirection: "column", gap: "0.2rem" },
  sessDay:    { fontSize: "0.75rem", color: "#64748b" },
  sessDesc:   { fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 500 },
  sessRight:  { display: "flex", gap: "1rem", alignItems: "center" },
  sessMeta:   { fontSize: "0.8rem", color: "#94a3b8", textAlign: "right" },
  sessTss:    { fontSize: "1rem", fontWeight: 700, color: "#38bdf8", minWidth: "2.5rem", textAlign: "right" },
  disclaimer: { fontSize: "0.72rem", color: "#475569", marginTop: "0.5rem" },
  loading:    { color: "#94a3b8", padding: "2rem", textAlign: "center" },
  error:      { color: "#f87171", padding: "2rem", textAlign: "center" },
};

export default function CampDashboard({ slug }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    fetch(`/api/camp/${slug}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div style={S.loading}>Carregando...</div>;
  if (error)   return <div style={S.error}>Erro ao carregar dados.</div>;
  if (!data?.totals) return <div style={S.loading}>Sem dados.</div>;

  const { name, start_date, end_date, location, totals, sessions, lastActivity } = data;

  return (
    <div style={S.page}>

      {/* ── Cabeçalho ──────────────────────────────────── */}
      <div style={S.header}>
        <h1 style={S.title}>{name}</h1>
        {location && <p style={S.subtitle}>{location}</p>}
        <p style={S.subtitle}>{start_date} → {end_date}</p>
      </div>

      {/* ── Acumulados ─────────────────────────────────── */}
      <div style={S.section}>
        <div style={S.sTitle}>Acumulado do camp</div>
        <div style={S.grid}>
          <div style={S.card}>
            <span style={S.cardLabel}>Distância</span>
            <span style={S.cardValue}>{fmtKm(totals.distance_m)}</span>
          </div>
          <div style={S.card}>
            <span style={S.cardLabel}>Elevação</span>
            <span style={S.cardValue}>{fmtElev(totals.elevation_m)}</span>
          </div>
          <div style={S.card}>
            <span style={S.cardLabel}>Tempo</span>
            <span style={S.cardValue}>{fmtTime(totals.moving_time_sec)}</span>
          </div>
          <div style={S.card}>
            <span style={S.cardLabel}>Atividades</span>
            <span style={S.cardValue}>{totals.activities}</span>
          </div>
          <div style={S.card}>
            <span style={S.cardLabel}>TSS*</span>
            <span style={{ ...S.cardValue, color: "#38bdf8" }}>{Math.round(totals.tss)}</span>
          </div>
        </div>
        <p style={S.disclaimer}>
          * TSS representa apenas o impacto estimado das atividades deste camp,
          calculado com NP e FTP estimados quando não há sensor de potência.
          Não reflete o TSS real do atleta.
        </p>
      </div>

      {/* ── Sessões realizadas ──────────────────────────── */}
      {sessions?.length > 0 && (
        <div style={S.section}>
          <div style={S.sTitle}>Sessões realizadas</div>
          {sessions.map((s, i) => (
            <div key={i} style={S.sessCard}>
              <div style={S.sessLeft}>
                <span style={S.sessDay}>Dia {s.day_number} · Sessão {s.session_order}</span>
                <span style={S.sessDesc}>{s.short_description || "—"}</span>
              </div>
              <div style={S.sessRight}>
                <div style={S.sessMeta}>
                  <div>{fmtKm(s.distance_m)}</div>
                  <div>{fmtElev(s.total_elevation_gain)}</div>
                  <div>{fmtTime(s.moving_time)}</div>
                </div>
                <div style={S.sessTss}>
                  {s.tss != null ? Math.round(s.tss) : "—"}
                  <div style={{ fontSize: "0.65rem", color: "#475569", fontWeight: 400 }}>TSS*</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Última atividade ────────────────────────────── */}
      {lastActivity && (
        <div style={S.section}>
          <div style={S.sTitle}>Última atividade</div>
          <div style={S.grid}>
            <div style={S.card}>
              <span style={S.cardLabel}>Data</span>
              <span style={{ ...S.cardValue, fontSize: "1rem" }}>{lastActivity.date}</span>
            </div>
            <div style={S.card}>
              <span style={S.cardLabel}>Distância</span>
              <span style={S.cardValue}>{fmtKm(lastActivity.distance_m)}</span>
            </div>
            <div style={S.card}>
              <span style={S.cardLabel}>Elevação</span>
              <span style={S.cardValue}>{fmtElev(lastActivity.total_elevation_gain)}</span>
            </div>
            <div style={S.card}>
              <span style={S.cardLabel}>Tempo</span>
              <span style={S.cardValue}>{fmtTime(lastActivity.moving_time)}</span>
            </div>
            {lastActivity.tss != null && (
              <div style={S.card}>
                <span style={S.cardLabel}>TSS*</span>
                <span style={{ ...S.cardValue, color: "#38bdf8" }}>{Math.round(lastActivity.tss)}</span>
              </div>
            )}
            {lastActivity.average_heartrate && (
              <div style={S.card}>
                <span style={S.cardLabel}>FC média</span>
                <span style={S.cardValue}>{Math.round(lastActivity.average_heartrate)}</span>
                <span style={S.cardSub}>bpm</span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
