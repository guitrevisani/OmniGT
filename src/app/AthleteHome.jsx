// src/app/AthleteHome.jsx
"use client";

import { useState, useEffect } from "react";

function fmtDate(str) {
  if (!str) return "—";
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

function fmtBirthDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-");
  const age = new Date().getFullYear() - parseInt(y);
  return `${d}/${m}/${y} (${age} anos)`;
}

const S = {
  page:      { minHeight: "100dvh", background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", padding: "1.5rem 1rem" },
  header:    { marginBottom: "2rem" },
  name:      { fontSize: "1.4rem", fontWeight: 700, color: "#f8fafc", margin: 0 },
  meta:      { fontSize: "0.85rem", color: "#94a3b8", marginTop: "0.25rem" },
  section:   { marginBottom: "1.75rem" },
  sTitle:    { fontSize: "0.8rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" },
  eventCard: { background: "#1e293b", borderRadius: "0.75rem", padding: "1rem 1.25rem", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "inherit" },
  eventName: { fontSize: "0.95rem", fontWeight: 600, color: "#f8fafc" },
  eventMeta: { fontSize: "0.75rem", color: "#64748b", marginTop: "0.2rem" },
  eventArrow:{ fontSize: "1rem", color: "#38bdf8" },
  actCard:   { background: "#1e293b", borderRadius: "0.75rem", padding: "0.875rem 1.25rem", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" },
  actTitle:  { fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 500 },
  actMeta:   { fontSize: "0.75rem", color: "#64748b", marginTop: "0.2rem" },
  actTime:   { fontSize: "0.85rem", color: "#94a3b8" },
  empty:     { fontSize: "0.85rem", color: "#475569", fontStyle: "italic" },
  loading:   { color: "#94a3b8", padding: "2rem", textAlign: "center" },
  error:     { color: "#f87171", padding: "2rem", textAlign: "center" },
  signature: { position: "fixed", bottom: "1.25rem", right: "1.25rem", opacity: 0.4 },
};

export default function AthleteHome() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    fetch("/api/athlete/home")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={S.loading}>Carregando...</div>;
  if (error)   return <div style={S.error}>Erro ao carregar dados.</div>;
  if (!data)   return null;

  const { athlete, events, activities } = data;

  return (
    <div style={S.page}>

      {/* ── Cabeçalho ──────────────────────────────────── */}
      <div style={S.header}>
        <h1 style={S.name}>{athlete.firstname} {athlete.lastname}</h1>
        {athlete.email     && <p style={S.meta}>{athlete.email}</p>}
        {athlete.birth_date && <p style={S.meta}>{fmtBirthDate(athlete.birth_date)}</p>}
      </div>

      {/* ── Eventos ativos ──────────────────────────────── */}
      <div style={S.section}>
        <div style={S.sTitle}>Eventos ativos</div>
        {events.length === 0 && (
          <p style={S.empty}>Nenhum evento ativo.</p>
        )}
        {events.map((e, i) => (
          <a key={i} href={`/${e.slug}/dashboard`} style={S.eventCard}>
            <div>
              <div style={S.eventName}>{e.name}</div>
              <div style={S.eventMeta}>{fmtDate(e.start_date)} → {fmtDate(e.end_date)}</div>
            </div>
            <span style={S.eventArrow}>→</span>
          </a>
        ))}
      </div>

      {/* ── Últimas atividades ──────────────────────────── */}
      <div style={S.section}>
        <div style={S.sTitle}>Últimas atividades processadas</div>
        {activities.length === 0 && (
          <p style={S.empty}>Nenhuma atividade processada ainda.</p>
        )}
        {activities.map((a, i) => (
          <div key={i} style={S.actCard}>
            <div>
              <div style={S.actTitle}>{a.title || "Atividade sem título"}</div>
              <div style={S.actMeta}>{fmtDate(a.date)}</div>
            </div>
            <span style={S.actTime}>{a.time}</span>
          </div>
        ))}
      </div>

      {/* ── Assinatura ──────────────────────────────────── */}
      <a href="https://www.treine.com.gt" target="_blank" rel="noopener noreferrer" style={S.signature}>
        <img src="/treinecomgt.svg" alt="treine.com.gt" style={{ width: "140px", height: "auto" }} />
      </a>

    </div>
  );
}
