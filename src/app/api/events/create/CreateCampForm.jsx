"use client";

// src/app/events/create/CreateCampForm.jsx
//
// Acessível por OWNER (logado no Strava) e PROVIDER.
// OWNER → owner_strava_id preenchido e bloqueado com o próprio stravaId
// PROVIDER → owner_strava_id editável (pode criar para qualquer owner)
//
// Cobre todos os campos editáveis de:
//   events, event_configs (metadata), camp_sessions

import { useState } from "react";
import { useRouter } from "next/navigation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:        "#09101f",
  surface:   "#111827",
  border:    "#1f2d42",
  borderHov: "#2a3f5a",
  text:      "#e2e8f0",
  muted:     "#64748b",
  dim:       "#334155",
  accent:    "#3b82f6",
  accentDim: "#1d4ed8",
  danger:    "#ef4444",
  ok:        "#22c55e",
};

const S = {
  page: {
    minHeight: "100dvh",
    background: C.bg,
    color: C.text,
    fontFamily: "'IBM Plex Mono', 'Fira Code', 'Cascadia Code', monospace",
    padding: "2rem 1rem 5rem",
  },
  inner: { maxWidth: 760, margin: "0 auto" },

  // Cabeçalho
  badge: {
    display: "inline-block",
    fontSize: "0.65rem",
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.accent,
    background: "#0f1f3d",
    border: `1px solid #1e3a6e`,
    borderRadius: "0.25rem",
    padding: "0.15rem 0.5rem",
    marginBottom: "1rem",
  },
  heading: {
    fontSize: "1.6rem",
    fontWeight: 700,
    color: "#f1f5f9",
    margin: "0 0 0.3rem",
    letterSpacing: "-0.03em",
  },
  sub: {
    fontSize: "0.78rem",
    color: C.muted,
    marginBottom: "2.5rem",
    lineHeight: 1.5,
  },

  // Seções
  section: { marginBottom: "2.25rem" },
  sHead: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    marginBottom: "1.1rem",
  },
  sNum: {
    fontSize: "0.65rem",
    fontWeight: 700,
    color: C.accent,
    background: "#0f1f3d",
    border: `1px solid #1e3a6e`,
    borderRadius: "0.2rem",
    padding: "0.1rem 0.4rem",
  },
  sTitle: {
    fontSize: "0.7rem",
    fontWeight: 700,
    color: C.dim,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  sDivider: {
    flex: 1,
    height: "1px",
    background: C.border,
  },

  // Grid
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" },

  // Campos
  field: { display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.85rem" },
  label: { fontSize: "0.72rem", color: C.muted, letterSpacing: "0.04em" },
  req: { color: C.danger, marginLeft: "0.15rem" },
  hint: { fontSize: "0.68rem", color: C.dim, fontStyle: "italic", lineHeight: 1.4 },
  slugPreview: { fontSize: "0.7rem", color: C.accent },
  input: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: "0.35rem",
    color: C.text,
    fontSize: "0.88rem",
    padding: "0.55rem 0.75rem",
    outline: "none",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  },
  textarea: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: "0.35rem",
    color: C.text,
    fontSize: "0.88rem",
    padding: "0.55rem 0.75rem",
    outline: "none",
    fontFamily: "inherit",
    resize: "vertical",
    minHeight: "4.5rem",
    lineHeight: 1.55,
    width: "100%",
    boxSizing: "border-box",
  },
  select: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: "0.35rem",
    color: C.text,
    fontSize: "0.88rem",
    padding: "0.55rem 0.75rem",
    outline: "none",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
    cursor: "pointer",
    appearance: "none",
  },
  readOnly: { opacity: 0.45, cursor: "not-allowed" },

  // Toggle
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: "0.35rem",
    padding: "0.65rem 0.9rem",
    cursor: "pointer",
    marginBottom: "0.5rem",
  },
  toggleLabel: { fontSize: "0.84rem", color: C.text },
  toggleHint: { fontSize: "0.68rem", color: C.muted, marginTop: "0.1rem" },
  pill: (on) => ({
    width: "2.2rem", height: "1.2rem", borderRadius: "99px",
    background: on ? C.accent : C.border,
    position: "relative", flexShrink: 0, transition: "background 0.2s",
  }),
  knob: (on) => ({
    position: "absolute", top: "0.13rem",
    left: on ? "1.05rem" : "0.13rem",
    width: "0.94rem", height: "0.94rem",
    borderRadius: "50%",
    background: on ? "#fff" : C.dim,
    transition: "left 0.18s, background 0.2s",
  }),

  // Sessão card
  sessCard: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: "0.5rem",
    padding: "1.1rem",
    marginBottom: "0.75rem",
  },
  sessCardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.9rem",
  },
  sessLabel: {
    fontSize: "0.68rem",
    color: C.muted,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  removeBtn: {
    background: "none", border: "none",
    color: C.dim, cursor: "pointer",
    fontSize: "0.82rem", padding: "0.15rem 0.4rem",
    borderRadius: "0.2rem", fontFamily: "inherit",
    transition: "color 0.15s",
  },
  addBtn: {
    background: "none",
    border: `1px dashed ${C.border}`,
    borderRadius: "0.4rem",
    color: C.accent,
    cursor: "pointer",
    fontSize: "0.8rem",
    padding: "0.6rem",
    width: "100%",
    textAlign: "center",
    fontFamily: "inherit",
    letterSpacing: "0.04em",
    marginBottom: "0.5rem",
    transition: "border-color 0.15s",
  },

  // Alertas
  error: {
    background: "#1a0a0a", border: `1px solid #7f1d1d`,
    borderRadius: "0.35rem", color: "#fca5a5",
    fontSize: "0.8rem", padding: "0.7rem 1rem",
    marginBottom: "1.5rem", lineHeight: 1.5,
  },
  success: {
    background: "#071a0e", border: `1px solid #14532d`,
    borderRadius: "0.35rem", color: "#86efac",
    fontSize: "0.8rem", padding: "0.7rem 1rem",
    marginBottom: "1.5rem",
  },

  // Submit
  divider: { borderTop: `1px solid ${C.border}`, margin: "1.75rem 0" },
  submitBtn: {
    background: C.accent, border: "none",
    borderRadius: "0.4rem", color: "#fff",
    cursor: "pointer", fontSize: "0.9rem",
    fontWeight: 700, fontFamily: "inherit",
    padding: "0.8rem 2rem",
    width: "100%", letterSpacing: "0.02em",
    transition: "background 0.15s, opacity 0.15s",
  },
  submitDisabled: { opacity: 0.4, cursor: "not-allowed" },

  // Cor picker
  colorRow: { display: "flex", gap: "0.5rem", alignItems: "center" },
  colorSwatch: {
    width: "2.4rem", height: "2.4rem",
    border: `1px solid ${C.border}`,
    borderRadius: "0.3rem",
    cursor: "pointer", padding: 0, background: "none",
  },
};

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SectionHead({ num, title }) {
  return (
    <div style={S.sHead}>
      <span style={S.sNum}>{num}</span>
      <span style={S.sTitle}>{title}</span>
      <div style={S.sDivider} />
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <div style={S.field}>
      <label style={S.label}>
        {label}
        {required && <span style={S.req}>*</span>}
      </label>
      {children}
      {hint && <span style={S.hint}>{hint}</span>}
    </div>
  );
}

function Toggle({ on, onToggle, label, hint }) {
  return (
    <div style={S.toggleRow} onClick={onToggle}>
      <div>
        <div style={S.toggleLabel}>{label}</div>
        {hint && <div style={S.toggleHint}>{hint}</div>}
      </div>
      <div style={S.pill(on)}>
        <div style={S.knob(on)} />
      </div>
    </div>
  );
}

// ─── Estado inicial de sessão (todos os campos de camp_sessions) ──────────────

const emptySession = (dayNumber = 1) => ({
  // Identificação
  name:             "",
  activity_type:    "Ride",

  // Programação
  day_number:       dayNumber,
  session_order:    1,
  scheduled_date:   "",
  scheduled_start:  "",

  // Rota Strava
  strava_route_id:  "",

  // Conteúdo
  objective:        "",
  short_description: "",
  description:      "",

  // Flags
  is_optional:      false,
});

// ─── Card de sessão (todos os campos de camp_sessions) ───────────────────────

function SessionCard({ index, session, onChange, onRemove, canRemove }) {
  const upd = (k, v) => onChange(index, { ...session, [k]: v });

  return (
    <div style={S.sessCard}>
      <div style={S.sessCardHead}>
        <span style={S.sessLabel}>Sessão {index + 1}</span>
        {canRemove && (
          <button style={S.removeBtn} onClick={() => onRemove(index)} title="Remover">✕</button>
        )}
      </div>

      {/* Identificação */}
      <div style={S.grid2}>
        <Field label="Nome da Sessão" required>
          <input
            style={S.input}
            value={session.name}
            onChange={e => upd("name", e.target.value)}
            placeholder="Ex: Pedalada Longa"
          />
        </Field>
        <Field label="Tipo de Atividade" required>
          <select style={S.select} value={session.activity_type} onChange={e => upd("activity_type", e.target.value)}>
            <option value="Ride">Ride — Ciclismo</option>
            <option value="VirtualRide">Virtual Ride</option>
            <option value="Run">Run — Corrida</option>
            <option value="Swim">Swim — Natação</option>
            <option value="Walk">Walk — Caminhada</option>
            <option value="Hike">Hike — Trilha</option>
            <option value="WeightTraining">Musculação</option>
            <option value="Yoga">Yoga</option>
            <option value="Other">Outro</option>
          </select>
        </Field>
      </div>

      {/* Programação */}
      <div style={S.grid3}>
        <Field label="Dia do Camp" required hint="Sequencial: 1, 2, 3…">
          <input
            style={S.input}
            type="number" min={1}
            value={session.day_number}
            onChange={e => upd("day_number", e.target.value)}
          />
        </Field>
        <Field label="Ordem no Dia" hint="Se há mais de uma sessão/dia">
          <input
            style={S.input}
            type="number" min={1}
            value={session.session_order}
            onChange={e => upd("session_order", e.target.value)}
          />
        </Field>
        <Field label="Horário de Largada">
          <input
            style={S.input}
            type="time"
            value={session.scheduled_start}
            onChange={e => upd("scheduled_start", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Data Programada" hint="Data real da sessão (dentro do intervalo do camp)">
        <input
          style={S.input}
          type="date"
          value={session.scheduled_date}
          onChange={e => upd("scheduled_date", e.target.value)}
        />
      </Field>

      {/* Rota Strava */}
      <Field
        label="Strava Route ID"
        hint="ID numérico da rota no Strava (visível na URL da rota). Usado para exibir o percurso no dashboard."
      >
        <input
          style={S.input}
          type="number"
          value={session.strava_route_id}
          onChange={e => upd("strava_route_id", e.target.value)}
          placeholder="Ex: 3123456789"
        />
      </Field>

      {/* Conteúdo */}
      <Field label="Objetivo" hint="Fisiológico ou técnico — aparece destacado no dashboard">
        <input
          style={S.input}
          value={session.objective}
          onChange={e => upd("objective", e.target.value)}
          placeholder="Ex: Resistência aeróbica Z2, 3h contínuas"
        />
      </Field>

      <Field label="Descrição Curta" hint="Uma linha — aparece nos cards de resumo">
        <input
          style={S.input}
          value={session.short_description}
          onChange={e => upd("short_description", e.target.value)}
          placeholder="Ex: 80 km com 1.200 m de ganho — ritmo controlado"
        />
      </Field>

      <Field label="Descrição Completa" hint="Detalhes, intensidade, dicas de equipamento…">
        <textarea
          style={S.textarea}
          value={session.description}
          onChange={e => upd("description", e.target.value)}
          placeholder="Descreva a sessão em detalhes para os atletas..."
          rows={3}
        />
      </Field>

      {/* Flag opcional */}
      <Toggle
        on={session.is_optional}
        onToggle={() => upd("is_optional", !session.is_optional)}
        label="Sessão Opcional"
        hint="Sessões opcionais não contam para o status geral do atleta"
      />
    </div>
  );
}

// ─── Formulário Principal ─────────────────────────────────────────────────────

export default function CreateCampForm({ stravaId, isProvider }) {
  const router = useRouter();

  // ── Evento
  const [name, setName]           = useState("");
  const [slugAuto, setSlugAuto]   = useState(true);
  const [slugManual, setSlugManual] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [accessMode, setAccessMode] = useState("private");
  const [isActive, setIsActive]   = useState(true);

  // ── Owner (PROVIDER pode editar, OWNER é fixo)
  const [ownerStravaId, setOwnerStravaId] = useState(String(stravaId));

  // ── Metadata / event_configs
  const [location, setLocation]         = useState("");
  const [objective, setObjective]       = useState("");
  const [websiteUrl, setWebsiteUrl]     = useState("");
  const [maxDays, setMaxDays]           = useState("");
  const [colorPrimary, setColorPrimary] = useState("#3b82f6");
  const [colorSecondary, setColorSecondary] = useState("#09101f");
  const [logoUrl, setLogoUrl]           = useState("");

  // ── Push
  const [pushHeading, setPushHeading] = useState("");
  const [pushBody, setPushBody]       = useState("");

  // ── Sessões
  const [sessions, setSessions] = useState([emptySession(1)]);

  // ── UI
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(null);

  const slug = slugAuto ? slugify(name) : slugManual;

  const addSession = () => {
    const nextDay = Math.max(...sessions.map(s => Number(s.day_number) || 1));
    setSessions(s => [...s, emptySession(nextDay)]);
  };

  const removeSession = i => setSessions(s => s.filter((_, idx) => idx !== i));
  const updateSession = (i, val) => setSessions(s => s.map((x, idx) => idx === i ? val : x));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim() || !slug || !startDate || !endDate) {
      setError("Preencha: nome, slug, data de início e data de fim.");
      return;
    }
    if (startDate > endDate) {
      setError("A data de início deve ser anterior à data de fim.");
      return;
    }

    const incompleteSessions = sessions.filter(s => !s.name.trim());
    if (incompleteSessions.length > 0) {
      setError(`${incompleteSessions.length} sessão(ões) sem nome. Preencha ou remova.`);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           name.trim(),
          slug,
          start_date:     startDate,
          end_date:       endDate,
          access_mode:    accessMode,
          is_active:      isActive,
          owner_strava_id: ownerStravaId ? parseInt(ownerStravaId) : stravaId,
          push_heading:   pushHeading || null,
          push_body:      pushBody    || null,
          metadata: {
            location:    location   || null,
            objective:   objective  || null,
            website_url: websiteUrl || null,
            max_days:    maxDays ? parseInt(maxDays) : null,
          },
          config: {
            color_primary:   colorPrimary   || null,
            color_secondary: colorSecondary || null,
            logo_url:        logoUrl        || null,
          },
          sessions: sessions.map(s => ({
            name:             s.name.trim(),
            activity_type:    s.activity_type,
            day_number:       parseInt(s.day_number)    || 1,
            session_order:    parseInt(s.session_order) || 1,
            scheduled_date:   s.scheduled_date  || null,
            scheduled_start:  s.scheduled_start || null,
            strava_route_id:  s.strava_route_id ? parseInt(s.strava_route_id) : null,
            objective:        s.objective        || null,
            short_description: s.short_description || null,
            description:      s.description     || null,
            is_optional:      s.is_optional      ?? false,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao criar evento.");
        return;
      }

      setSuccess(`Evento "${data.event.name}" criado com ${data.sessions_created} sessão(ões)!`);
      setTimeout(() => router.push(`/${data.event.slug}/dashboard`), 2000);

    } catch (err) {
      setError("Erro inesperado. Verifique o console.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.inner}>

        {/* ── Cabeçalho */}
        <div style={S.badge}>{isProvider ? "PROVIDER" : "OWNER"}</div>
        <h1 style={S.heading}>Criar Evento Camp</h1>
        <p style={S.sub}>
          Módulo camp · Registro obrigatório · Sessões com rastreamento Strava
        </p>

        {error   && <div style={S.error}>{error}</div>}
        {success && <div style={S.success}>{success}</div>}

        <form onSubmit={handleSubmit} autoComplete="off">

          {/* ── 1. Identificação */}
          <div style={S.section}>
            <SectionHead num="01" title="Identificação do Evento" />

            <Field label="Nome do Evento" required>
              <input
                style={S.input}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Camp Serra Gaúcha 2025"
              />
            </Field>

            <Field label="Slug (URL do evento)">
              {slugAuto ? (
                <>
                  <input style={{ ...S.input, ...S.readOnly }} value={slug || "gerado a partir do nome"} readOnly />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {slug && <span style={S.slugPreview}>/{slug}</span>}
                    <span
                      style={{ fontSize: "0.68rem", color: C.accent, cursor: "pointer" }}
                      onClick={() => { setSlugManual(slug); setSlugAuto(false); }}
                    >
                      ✎ editar manualmente
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <input
                    style={S.input}
                    value={slugManual}
                    onChange={e => setSlugManual(slugify(e.target.value))}
                    placeholder="camp-serra-gaucha-2025"
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {slugManual && <span style={S.slugPreview}>/{slugManual}</span>}
                    <span
                      style={{ fontSize: "0.68rem", color: C.muted, cursor: "pointer" }}
                      onClick={() => setSlugAuto(true)}
                    >
                      ↺ usar automático
                    </span>
                  </div>
                </>
              )}
            </Field>

            <div style={S.grid2}>
              <Field label="Data de Início" required>
                <input style={S.input} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </Field>
              <Field label="Data de Fim" required>
                <input style={S.input} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </Field>
            </div>

            <div style={S.grid2}>
              <Field label="Modo de Acesso">
                <select style={S.select} value={accessMode} onChange={e => setAccessMode(e.target.value)}>
                  <option value="private">Privado (convite)</option>
                  <option value="public">Público</option>
                  <option value="code">Código de acesso</option>
                </select>
              </Field>
              <Field label="Scopes Strava Obrigatórios">
                <input style={{ ...S.input, ...S.readOnly }} value="read, activity:read_all" readOnly />
              </Field>
            </div>

            <Toggle
              on={isActive}
              onToggle={() => setIsActive(v => !v)}
              label="Evento Ativo"
              hint="Eventos inativos não aceitam novas inscrições e ficam ocultos"
            />
          </div>

          {/* ── 2. Owner */}
          <div style={S.section}>
            <SectionHead num="02" title="Owner do Evento" />

            <Field
              label="Strava ID do Owner"
              hint={
                isProvider
                  ? "PROVIDER pode definir qualquer owner. Deixe em branco para atribuir depois."
                  : "Preenchido automaticamente com seu Strava ID. Você será o OWNER."
              }
            >
              <input
                style={{ ...S.input, ...(isProvider ? {} : S.readOnly) }}
                type="number"
                value={ownerStravaId}
                onChange={e => isProvider && setOwnerStravaId(e.target.value)}
                readOnly={!isProvider}
                placeholder={isProvider ? "Ex: 12345678" : String(stravaId)}
              />
            </Field>
          </div>

          {/* ── 3. Informações do Camp */}
          <div style={S.section}>
            <SectionHead num="03" title="Informações do Camp" />

            <div style={S.grid2}>
              <Field label="Localização">
                <input style={S.input} value={location} onChange={e => setLocation(e.target.value)} placeholder="Serra Gaúcha, RS" />
              </Field>
              <Field label="Máx. de Dias">
                <input style={S.input} type="number" min={1} value={maxDays} onChange={e => setMaxDays(e.target.value)} placeholder="Ex: 5" />
              </Field>
            </div>

            <Field label="Objetivo do Camp" hint="Apresentado na página de inscrição e no dashboard">
              <textarea
                style={S.textarea}
                value={objective}
                onChange={e => setObjective(e.target.value)}
                placeholder="Descreva o foco e objetivo principal do camp para os atletas..."
                rows={2}
              />
            </Field>

            <Field label="Site / Landing Page">
              <input style={S.input} type="url" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://..." />
            </Field>
          </div>

          {/* ── 4. Aparência */}
          <div style={S.section}>
            <SectionHead num="04" title="Aparência (event_configs)" />

            <div style={S.grid2}>
              <Field label="Cor Primária">
                <div style={S.colorRow}>
                  <input
                    type="color"
                    value={colorPrimary}
                    onChange={e => setColorPrimary(e.target.value)}
                    style={S.colorSwatch}
                  />
                  <input style={{ ...S.input, flex: 1 }} value={colorPrimary} onChange={e => setColorPrimary(e.target.value)} />
                </div>
              </Field>
              <Field label="Cor Secundária">
                <div style={S.colorRow}>
                  <input
                    type="color"
                    value={colorSecondary}
                    onChange={e => setColorSecondary(e.target.value)}
                    style={S.colorSwatch}
                  />
                  <input style={{ ...S.input, flex: 1 }} value={colorSecondary} onChange={e => setColorSecondary(e.target.value)} />
                </div>
              </Field>
            </div>

            <Field label="URL do Logo">
              <input style={S.input} type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://cdn.../logo.png" />
            </Field>
          </div>

          {/* ── 5. Push Notifications */}
          <div style={S.section}>
            <SectionHead num="05" title="Push Notifications" />
            <Field label="Título Padrão" hint="Usado como heading nas notificações do evento">
              <input style={S.input} value={pushHeading} onChange={e => setPushHeading(e.target.value)} placeholder="Ex: Camp Serra Gaúcha" />
            </Field>
            <Field label="Corpo Padrão" hint="Texto padrão quando não especificado no disparo">
              <textarea style={S.textarea} rows={2} value={pushBody} onChange={e => setPushBody(e.target.value)} placeholder="Ex: Você tem uma novidade no seu camp!" />
            </Field>
          </div>

          {/* ── 6. Sessões */}
          <div style={S.section}>
            <SectionHead num="06" title={`Sessões do Camp (${sessions.length})`} />

            {sessions.map((s, i) => (
              <SessionCard
                key={i}
                index={i}
                session={s}
                onChange={updateSession}
                onRemove={removeSession}
                canRemove={sessions.length > 1}
              />
            ))}

            <button type="button" style={S.addBtn} onClick={addSession}>
              + Adicionar Sessão
            </button>
          </div>

          <div style={S.divider} />

          <button
            type="submit"
            style={{ ...S.submitBtn, ...(loading ? S.submitDisabled : {}) }}
            disabled={loading}
          >
            {loading ? "Criando evento…" : `Criar Evento Camp com ${sessions.length} sessão(ões)`}
          </button>

        </form>
      </div>
    </div>
  );
}
