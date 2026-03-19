// src/app/[slug]/register/AgendaRegister.jsx
//
// Formulário de inscrição do módulo Agenda.
// Extraído de register/page.js para seguir o padrão de dispatcher por módulo.

"use client";

import { useState, useEffect } from "react";

export default function AgendaRegister({ slug, searchParams }) {
  const warn = searchParams?.warn;

  const [event,             setEvent]             = useState(null);
  const [consentGiven,      setConsentGiven]      = useState(false);
  const [pushConsent,       setPushConsent]       = useState(false);
  const [keepGoals,         setKeepGoals]         = useState(true);
  const [personalGoalKm,    setPersonalGoalKm]    = useState("");
  const [personalGoalHours, setPersonalGoalHours] = useState("");
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState(null);

  useEffect(() => {
    async function fetchEvent() {
      if (!slug) return;
      try {
        const res = await fetch(`/api/events?slug=${slug}`);
        if (!res.ok) throw new Error("Evento não encontrado");
        const data = await res.json();
        setEvent(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchEvent();
  }, [slug]);

  useEffect(() => {
    if (warn === "no_goals") setKeepGoals(false);
  }, [warn]);

  if (loading) return <p style={{ padding: "2rem", fontFamily: "sans-serif" }}>Carregando evento...</p>;
  if (error)   return <p style={{ padding: "2rem", fontFamily: "sans-serif" }}>Erro: {error}</p>;
  if (!event)  return <p style={{ padding: "2rem", fontFamily: "sans-serif" }}>Evento não encontrado</p>;

  const formatDate = (str) => new Date(str + "T12:00:00").toLocaleDateString();

  const goalsValid = keepGoals || (personalGoalKm !== "" && personalGoalHours !== "");
  const canSubmit  = consentGiven && goalsValid;

  const oauthUrl = canSubmit
    ? `/api/auth/strava/start?event=${slug}` +
      `&keep_goals=${keepGoals ? "1" : "0"}` +
      `&goal_km=${encodeURIComponent(keepGoals ? "" : personalGoalKm)}` +
      `&goal_hours=${encodeURIComponent(keepGoals ? "" : personalGoalHours)}` +
      `&push_consent=${pushConsent ? "1" : "0"}`
    : "#";

  return (
    <div style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "sans-serif", padding: "0 1rem" }}>

      <h1 style={{ marginBottom: "0.25rem" }}>{event.name}</h1>
      <p style={{ color: "#666", fontSize: 14, marginBottom: "1.5rem" }}>
        <strong>Período:</strong>{" "}
        {formatDate(event.start_date)} — {formatDate(event.end_date)}
      </p>

      {warn === "no_goals" && (
        <div style={{
          marginBottom: "1.5rem",
          padding:      "0.75rem 1rem",
          background:   "rgba(251,191,36,0.10)",
          borderLeft:   "4px solid #fbbf24",
          borderRadius: "0 6px 6px 0",
        }}>
          <p style={{ margin: 0, fontSize: 13, color: "#92400e", lineHeight: 1.5 }}>
            <strong>⚠ Você ainda não tem metas salvas.</strong><br />
            Preencha os campos abaixo para continuar.
          </p>
        </div>
      )}

      <hr style={{ margin: "1rem 0" }} />

      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", marginBottom: "1rem", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={keepGoals}
          onChange={e => setKeepGoals(e.target.checked)}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13, color: "#444", lineHeight: 1.5 }}>
          Manter minhas metas atuais
          <span style={{ display: "block", marginTop: 2, color: "#999", fontSize: 12 }}>
            Desmarque para definir ou atualizar suas metas de distância e tempo.
          </span>
        </span>
      </label>

      <div style={{
        opacity:       keepGoals ? 0.35 : 1,
        pointerEvents: keepGoals ? "none" : "auto",
        transition:    "opacity 0.2s ease",
        marginBottom:  "1.25rem",
      }}>
        <label style={{ display: "block", marginBottom: "1.25rem" }}>
          <span style={{ fontSize: 14 }}>Meta pessoal de distância (km)</span>
          <input
            type="number"
            min="0"
            value={personalGoalKm}
            onChange={e => setPersonalGoalKm(e.target.value)}
            disabled={keepGoals}
            style={{ display: "block", marginTop: "0.4rem", padding: "0.25rem 0.5rem", width: 100 }}
          />
        </label>
        <label style={{ display: "block" }}>
          <span style={{ fontSize: 14 }}>Meta pessoal de tempo (horas)</span>
          <input
            type="number"
            min="0"
            value={personalGoalHours}
            onChange={e => setPersonalGoalHours(e.target.value)}
            disabled={keepGoals}
            style={{ display: "block", marginTop: "0.4rem", padding: "0.25rem 0.5rem", width: 100 }}
          />
        </label>
      </div>

      <hr style={{ margin: "1rem 0" }} />

      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", marginBottom: "1rem", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={e => setConsentGiven(e.target.checked)}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13, color: "#444", lineHeight: 1.5 }}>
          Autorizo o acesso às minhas atividades no Strava para participação neste evento.
          Os dados serão usados exclusivamente para calcular métricas e atualizar a descrição
          das atividades elegíveis. Nenhuma informação é compartilhada com terceiros.
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", marginBottom: "1.75rem", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={pushConsent}
          onChange={e => setPushConsent(e.target.checked)}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13, color: "#444", lineHeight: 1.5 }}>
          Quero receber notificações quando uma atividade for processada pelo evento.
          <span style={{ display: "block", marginTop: 2, color: "#999", fontSize: 12 }}>
            Opcional — você poderá ativar ou desativar no dashboard a qualquer momento.
          </span>
        </span>
      </label>

      <a
        href={oauthUrl}
        style={{
          display:         "inline-block",
          padding:         "0.75rem 1.5rem",
          backgroundColor: canSubmit ? "#1fb6ff" : "#bbb",
          color:           "#fff",
          textDecoration:  "none",
          borderRadius:    6,
          fontSize:        14,
          pointerEvents:   canSubmit ? "auto" : "none",
        }}
      >
        Inscrever-se via Strava
      </a>
    </div>
  );
}
