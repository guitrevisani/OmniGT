// /src/app/[slug]/register/page.js
"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"

export default function EventRegistrationPage() {
  const params = useParams()
  const slug = params.slug

  const [event, setEvent] = useState(null)
  const [consentGiven, setConsentGiven] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [personalGoalKm, setPersonalGoalKm] = useState("")
  const [personalGoalHours, setPersonalGoalHours] = useState("")

  useEffect(() => {
    async function fetchEvent() {
      if (!slug) return
      try {
        const res = await fetch(`/api/events?slug=${slug}`)
        if (!res.ok) throw new Error("Evento não encontrado")
        const data = await res.json()
        setEvent(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchEvent()
  }, [slug])

  if (loading) return <p>Carregando evento...</p>
  if (error) return <p>Erro: {error}</p>
  if (!event) return <p>Evento não encontrado</p>

  const handleConsentChange = (e) => setConsentGiven(e.target.checked)
  const handleGoalKmChange = (e) => setPersonalGoalKm(e.target.value)
  const handleGoalHoursChange = (e) => setPersonalGoalHours(e.target.value)

  // Força interpretação local — evita offset UTC-3 virar dia anterior
  const formatDate = (str) =>
    new Date(str + "T12:00:00").toLocaleDateString()

  // Passa as metas como query para o OAuth
  const oauthUrl = consentGiven
    ? `/api/auth/strava/start?event=${slug}&goal_km=${encodeURIComponent(personalGoalKm)}&goal_hours=${encodeURIComponent(personalGoalHours)}`
    : "#"

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>{event.name}</h1>
      <p>
        <strong>Período:</strong>{" "}
        {formatDate(event.start_date)} -{" "}
        {formatDate(event.end_date)}
      </p>

      <hr style={{ margin: "1rem 0" }} />

      <label style={{ display: "block", marginBottom: "1rem" }}>
        Defina sua meta pessoal de distância (km):
        <input
          type="number"
          min="0"
          value={personalGoalKm}
          onChange={handleGoalKmChange}
          style={{ display: "block", marginTop: "0.5rem", padding: "0.25rem 0.5rem", width: "100px" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: "1rem" }}>
        Defina sua meta pessoal de tempo (horas):
        <input
          type="number"
          min="0"
          value={personalGoalHours}
          onChange={handleGoalHoursChange}
          style={{ display: "block", marginTop: "0.5rem", padding: "0.25rem 0.5rem", width: "100px" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: "1rem" }}>
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={handleConsentChange}
          style={{ marginRight: "0.5rem" }}
        />
        Autorizo a engine a usar meus dados para o evento e para sincronização com Strava
      </label>

      <a
        href={oauthUrl}
        style={{
          display: "inline-block",
          padding: "0.75rem 1.5rem",
          backgroundColor: consentGiven ? "#1fb6ff" : "#aaa",
          color: "#fff",
          textDecoration: "none",
          borderRadius: 6,
          pointerEvents: consentGiven ? "auto" : "none",
        }}
      >
        Inscrever-se via Strava
      </a>
    </div>
  )
}
