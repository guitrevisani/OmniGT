"use client";

import { useState, useEffect } from "react";

export default function AdminHome() {
  const [events, setEvents] = useState([]);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    start_date: new Date().toISOString().split("T")[0],
    end_date: new Date(new Date().setDate(new Date().getDate() + 7))
      .toISOString()
      .split("T")[0],
  });

  // Converte YYYY-MM-DD para dd/mm/yyyy
  function formatDateBR(dateString) {
    if (!dateString) return "";
    const [year, month, day] = dateString.split("-");
    return `${day}/${month}/${year}`;
  }

  // Lista eventos do Server
  useEffect(() => {
    async function loadEvents() {
      try {
        const res = await fetch("/api/events");
        const json = await res.json();
        // Garantir que json.events existe e é array
        setEvents(Array.isArray(json.events) ? json.events : []);
      } catch (err) {
        console.error("Erro ao carregar eventos:", err);
      }
    }
    loadEvents();
  }, []);

  // Cria novo evento
  async function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData();
    Object.entries(formData).forEach(([k, v]) => data.append(k, v));

    try {
      const res = await fetch("/api/events/create", { method: "POST", body: data });
      const json = await res.json();
      if (json.success) {
        setEvents([json.event, ...events]);
        setFormData({
          name: "",
          slug: "",
          start_date: formData.start_date,
          end_date: formData.end_date,
        });
        alert(`Evento criado: ${json.event.name}`);
      } else {
        alert("Erro ao criar evento");
      }
    } catch (err) {
      console.error("Erro ao criar evento:", err);
      alert("Erro ao criar evento");
    }
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h2>Eventos existentes</h2>
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            {e.name} ({e.slug}) - {formatDateBR(e.start_date)} até {formatDateBR(e.end_date)}
          </li>
        ))}
      </ul>

      <section style={{ marginTop: "2rem" }}>
        <h2>Criar novo evento</h2>
        <form
          onSubmit={handleSubmit}
          style={{ maxWidth: "400px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <label>
            Nome do evento:
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </label>
          <label>
            Slug:
            <input
              type="text"
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              required
            />
          </label>
          <label>
            Data de início:
            <input
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              required
            />
          </label>
          <label>
            Data de término:
            <input
              type="date"
              value={formData.end_date}
              onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
              required
            />
          </label>
          <button type="submit">Criar Evento</button>
        </form>
      </section>
    </div>
  );
}
