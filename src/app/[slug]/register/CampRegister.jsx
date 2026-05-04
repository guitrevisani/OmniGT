"use client";

// src/app/[slug]/register/CampRegister.jsx
//
// Formulário genérico do módulo camp.
// Campos extras específicos de cada evento são declarados em
// event_configs.metadata.extra_fields (array de strings) e
// renderizados condicionalmente. Os valores são enviados ao
// servidor em body.extra e gravados no banco do cliente.
//
// Campos extras suportados:
//   "shirt_size"  → seleção visual de tamanho (PP…XG) + modal de medidas
//   "route"       → radio longo | curto
//   "race_entry"  → radio sim | não

import { useState, useEffect } from "react";
import styles from "./CampRegister.module.css";

const CONSENT_VERSION = "1.0";
const SHIRT_SIZES     = ["PP", "P", "M", "G", "GG", "XG"];

// ── Modal tabela de medidas ───────────────────────────────────────────────────

function SizeTableModal({ onClose }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,.65)", zIndex: 99999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem", boxSizing: "border-box",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: "14px", padding: "1.5rem",
        width: "min(480px,100%)", boxShadow: "0 12px 40px rgba(0,0,0,.22)",
        boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", color: "#0b1a3b" }}>Tabela de medidas</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: "#666", lineHeight: 1 }}>×</button>
        </div>
        <img
          src="/tabelaMedidas_jersey_paleta.jpg"
          alt="Tabela de medidas do jersey"
          style={{ width: "100%", borderRadius: "8px", display: "block" }}
        />
      </div>
    </div>
  );
}

// ── Accordion para textos longos ──────────────────────────────────────────────

function Accordion({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid #e0e0e0", borderRadius: "8px", marginBottom: ".5rem" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: ".75rem 1rem",
          background: "none", border: "none", cursor: "pointer",
          fontSize: ".85rem", fontWeight: 600, color: "#333", textAlign: "left",
        }}
      >
        {title}
        <span style={{ fontSize: "1rem", transition: "transform .2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: ".25rem 1rem 1rem", fontSize: ".82rem", color: "#555", lineHeight: 1.65 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Campos extras ─────────────────────────────────────────────────────────────

function ExtraFields({ fields, extra, setExtra, showSizeModal, setShowSizeModal }) {
  if (!fields || fields.length === 0) return null;

  function set(key, val) {
    setExtra(prev => ({ ...prev, [key]: val }));
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Informações do evento</h2>

      {fields.includes("route") && (
        <div style={{ marginBottom: "1.25rem" }}>
          <span className={styles.fieldLabel}>
            Percurso <span className={styles.required}>*</span>
          </span>
          <div style={{ display: "flex", gap: ".75rem", marginTop: ".5rem" }}>
            {["longo", "curto"].map(opt => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: ".4rem", cursor: "pointer", fontSize: ".95rem" }}>
                <input
                  type="radio" name="route" value={opt}
                  checked={extra.route === opt}
                  onChange={() => set("route", opt)}
                  style={{ accentColor: "#fc4c02" }}
                />
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </label>
            ))}
          </div>
        </div>
      )}

      {fields.includes("race_entry") && (
        <div style={{ marginBottom: "1.25rem" }}>
          <span className={styles.fieldLabel}>
            Já está inscrito na prova? <span className={styles.required}>*</span>
          </span>
          <div style={{ display: "flex", gap: ".75rem", marginTop: ".5rem" }}>
            {[{ val: "sim", label: "Sim" }, { val: "nao", label: "Não" }].map(opt => (
              <label key={opt.val} style={{ display: "flex", alignItems: "center", gap: ".4rem", cursor: "pointer", fontSize: ".95rem" }}>
                <input
                  type="radio" name="race_entry" value={opt.val}
                  checked={extra.race_entry === opt.val}
                  onChange={() => set("race_entry", opt.val)}
                  style={{ accentColor: "#fc4c02" }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {fields.includes("shirt_size") && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: ".5rem" }}>
            <span className={styles.fieldLabel} style={{ margin: 0 }}>
              Tamanho da camiseta <span className={styles.required}>*</span>
            </span>
            <button
              type="button"
              onClick={() => setShowSizeModal(true)}
              style={{
                background: "none", border: "1px solid #ccc", borderRadius: "6px",
                padding: ".2rem .6rem", fontSize: ".78rem", cursor: "pointer", color: "#555",
              }}
            >
              Ver medidas
            </button>
          </div>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            {SHIRT_SIZES.map(s => (
              <button
                key={s} type="button"
                onClick={() => set("shirt_size", s)}
                style={{
                  padding: ".45rem .9rem", borderRadius: "8px", cursor: "pointer",
                  border: extra.shirt_size === s ? "2px solid #fc4c02" : "1px solid #ccc",
                  background: extra.shirt_size === s ? "#fff3ee" : "#fff",
                  color: extra.shirt_size === s ? "#fc4c02" : "#333",
                  fontWeight: extra.shirt_size === s ? 700 : 400,
                  fontSize: ".9rem", transition: "all .15s",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CampRegister({ slug, searchParams }) {
  const firstName = searchParams?.name || "";

  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);
  const [eventData, setEventData] = useState(null);
  const [extraFields, setExtraFields] = useState([]); // de metadata.extra_fields

  // Campos base
  const [firstname,      setFirstname]      = useState("");
  const [lastname,       setLastname]       = useState("");
  const [ftpW,           setFtpW]           = useState("");
  const [weightKg,       setWeightKg]       = useState("");
  const [hrMax,          setHrMax]          = useState("");
  const [hrZones,        setHrZones]        = useState(["", "", "", ""]);
  const [gender,         setGender]         = useState("");
  const [birthDate,      setBirthDate]      = useState("");
  const [email,          setEmail]          = useState("");
  const [whatsapp,       setWhatsapp]       = useState("");
  const [emergencyName,  setEmergencyName]  = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [medicalClearance, setMedicalClearance] = useState(false);
  const [consentGiven,   setConsentGiven]   = useState(false);
  const [lgpdConsent,    setLgpdConsent]    = useState(false);
  const [pushConsent,    setPushConsent]    = useState(false);

  // Campos extras (chave → valor, dinâmicos por evento)
  const [extra, setExtra] = useState({});

  // UI
  const [showSizeModal, setShowSizeModal] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/camp/${slug}/register`);
        if (!res.ok) throw new Error("Erro ao carregar dados");
        const data = await res.json();
        setEventData(data.event);
        setExtraFields(data.extra_fields || []);

        const p = data.profile;
        if (p) {
          if (p.ftp_w)           setFtpW(p.ftp_w);
          if (p.weight_kg)       setWeightKg(p.weight_kg);
          if (p.hr_max)          setHrMax(p.hr_max);
          if (p.hr_zones)        setHrZones(p.hr_zones.slice(0, 4).map(String));
          if (p.gender)          setGender(p.gender);
          if (p.birth_date)      setBirthDate(p.birth_date.slice(0, 10));
          if (p.email)           setEmail(p.email);
          if (p.whatsapp)        setWhatsapp(p.whatsapp);
          if (p.emergency_name)  setEmergencyName(p.emergency_name);
          if (p.emergency_phone) setEmergencyPhone(p.emergency_phone);
          if (p.firstname)       setFirstname(p.firstname);
          if (p.lastname)        setLastname(p.lastname);
          // Campos extras pré-preenchidos do banco do cliente, se houver
          if (data.extra_values) setExtra(data.extra_values);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug]);

  function updateHrZone(idx, val) {
    const next = [...hrZones];
    next[idx] = val;
    setHrZones(next);
  }

  // Valida campos extras obrigatórios presentes no evento
  const extraValid = extraFields.every(f => {
    if (f === "shirt_size") return !!extra.shirt_size;
    if (f === "route")      return !!extra.route;
    if (f === "race_entry") return extra.race_entry === "sim" || extra.race_entry === "nao";
    return true; // campos desconhecidos não bloqueiam
  });

  const canSubmit =
    firstname && lastname &&
    gender && birthDate && weightKg &&
    (email || whatsapp) &&
    extraValid &&
    medicalClearance && consentGiven && lgpdConsent;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      const zonesPayload = hrZones.some(z => z !== "")
        ? [...hrZones.map(Number), hrMax ? Number(hrMax) : null].filter(Boolean)
        : null;

      // Normaliza race_entry para booleano se presente
      const extraPayload = { ...extra };
      if ("race_entry" in extraPayload) {
        extraPayload.race_entry = extraPayload.race_entry === "sim";
      }

      const res = await fetch(`/api/camp/${slug}/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstname,
          lastname,
          ftp_w:            ftpW      ? Number(ftpW)      : null,
          weight_kg:        weightKg  ? Number(weightKg)  : null,
          hr_max:           hrMax     ? Number(hrMax)     : null,
          hr_zones:         zonesPayload,
          gender,
          birth_date:       birthDate,
          email:            email    || null,
          whatsapp:         whatsapp || null,
          emergency_name:   emergencyName  || null,
          emergency_phone:  emergencyPhone || null,
          medical_clearance: medicalClearance,
          consent_version:  CONSENT_VERSION,
          push_consent:     pushConsent,
          extra:            extraPayload,  // campos específicos do evento
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Erro ao salvar inscrição");
      }

      const data = await res.json();
      window.location.href = data.redirect || `/${slug}`;

    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading)    return <div className={styles.loading}>Carregando...</div>;
  if (!eventData) return <div className={styles.loading}>Evento não encontrado.</div>;

  return (
    <div className={styles.page}>
      {showSizeModal && <SizeTableModal onClose={() => setShowSizeModal(false)} />}

      <div className={styles.container}>

        {/* ── Cabeçalho ──────────────────────────────────── */}
        <div className={styles.header}>
          <span className={styles.headerBadge}>OGT Camp</span>
          {firstName && (
            <p style={{ margin: "0 0 .25rem", fontSize: ".95rem", color: "#666" }}>
              Olá, <strong>{firstName}</strong>! Complete seu cadastro abaixo.
            </p>
          )}
          <h1 className={styles.headerTitle}>{eventData.name}</h1>
          {eventData.location && (
            <p className={styles.headerMeta}>{eventData.location}</p>
          )}
        </div>

        {/* ── Identificação ───────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Identificação</h2>
          <p className={styles.sectionHint}>
            Informe seu nome como deseja que apareça nas comunicações e materiais do evento.
          </p>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Nome <span className={styles.required}>*</span></span>
              <input className={styles.input} type="text"
                value={firstname} onChange={e => setFirstname(e.target.value)}
                placeholder="Seu nome" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Sobrenome <span className={styles.required}>*</span></span>
              <input className={styles.input} type="text"
                value={lastname} onChange={e => setLastname(e.target.value)}
                placeholder="Seu sobrenome" />
            </label>
          </div>
        </section>

        {/* ── Campos extras do evento (dinâmicos) ─────────── */}
        <ExtraFields
          fields={extraFields}
          extra={extra}
          setExtra={setExtra}
          showSizeModal={showSizeModal}
          setShowSizeModal={setShowSizeModal}
        />

        {/* ── Métricas de referência ──────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Métricas de referência</h2>
          <p className={styles.sectionHint}>
            FTP, FC máx e zonas são opcionais — melhoram a precisão das estimativas.
            Peso é obrigatório.
          </p>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>FTP (W)</span>
              <input className={styles.input} type="number" min="0" max="600"
                value={ftpW} onChange={e => setFtpW(e.target.value)} placeholder="ex: 280" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Peso (kg) <span className={styles.required}>*</span>
              </span>
              <input className={styles.input} type="number" min="30" max="200" step="0.1"
                value={weightKg} onChange={e => setWeightKg(e.target.value)} placeholder="ex: 75" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>FC máx (bpm)</span>
              <input className={styles.input} type="number" min="100" max="230"
                value={hrMax} onChange={e => setHrMax(e.target.value)} placeholder="ex: 185" />
            </label>
          </div>

          <div className={styles.zonesGroup}>
            <span className={styles.fieldLabel}>Zonas de FC (bpm máx por zona)</span>
            <div className={styles.zonesRow}>
              {["Z1", "Z2", "Z3", "Z4"].map((z, i) => (
                <label key={z} className={styles.zoneField}>
                  <span className={styles.zoneLabel}>{z}</span>
                  <input className={styles.input} type="number" min="60" max="230"
                    value={hrZones[i]} onChange={e => updateHrZone(i, e.target.value)} placeholder="—" />
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* ── Dados pessoais ──────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados pessoais</h2>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Sexo biológico <span className={styles.required}>*</span>
              </span>
              <select className={styles.input} value={gender} onChange={e => setGender(e.target.value)}>
                <option value="">Selecione</option>
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
              </select>
              <span className={styles.fieldHint}>Usado exclusivamente para cálculos fisiológicos.</span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Data de nascimento <span className={styles.required}>*</span>
              </span>
              <input className={styles.input} type="date"
                value={birthDate} onChange={e => setBirthDate(e.target.value)} />
            </label>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Email{!whatsapp && <span className={styles.required}> *</span>}
              </span>
              <input className={styles.input} type="email"
                value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                WhatsApp{!email && <span className={styles.required}> *</span>}
              </span>
              <input className={styles.input} type="tel"
                value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+55 11 99999-9999" />
            </label>
          </div>
          <p className={styles.fieldHint}>Informe ao menos um meio de contato.</p>
        </section>

        {/* ── Emergência ──────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Contato de emergência</h2>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Nome</span>
              <input className={styles.input} type="text"
                value={emergencyName} onChange={e => setEmergencyName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Telefone</span>
              <input className={styles.input} type="tel"
                value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} />
            </label>
          </div>

          <label className={styles.checkboxLabel}>
            <input type="checkbox" className={styles.checkbox}
              checked={medicalClearance} onChange={e => setMedicalClearance(e.target.checked)} />
            <span className={styles.checkboxText}>
              Declaro ter consultado médico e obtido laudo autorizando a prática de
              atividades físicas intensas e de longa duração.
              <span className={styles.required}> *</span>
            </span>
          </label>
        </section>

        {/* ── Consentimento ───────────────────────────────── */}
        <section className={styles.section}>

          <Accordion title="Termo de consentimento">
            <p>
              Ao participar deste camp, o atleta declara estar ciente dos riscos inerentes
              à prática de ciclismo em estradas abertas ao tráfego e em terreno montanhoso,
              e isenta os organizadores de responsabilidade por acidentes decorrentes de sua
              própria conduta. A participação é voluntária e o atleta declara estar em
              condições físicas adequadas para as cargas previstas no programa.
            </p>
            <p style={{ color: "#999", fontStyle: "italic" }}>
              Texto completo a ser revisado pelos organizadores antes da abertura das inscrições.
            </p>
          </Accordion>

          <Accordion title="Política de privacidade (LGPD)">
            <p>
              Os dados coletados neste formulário são utilizados exclusivamente para a
              organização e comunicação deste evento. Nenhuma informação é compartilhada
              com terceiros sem consentimento expresso. O titular pode solicitar a exclusão
              dos seus dados a qualquer momento pelo canal de contato do organizador.
              Conforme a Lei 13.709/2018 (LGPD).
            </p>
            <p style={{ color: "#999", fontStyle: "italic" }}>
              Página dedicada em breve.
            </p>
          </Accordion>

          <label className={styles.checkboxLabel} style={{ marginTop: ".75rem" }}>
            <input type="checkbox" className={styles.checkbox}
              checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} />
            <span className={styles.checkboxText}>
              Li e aceito o Termo de Consentimento.
              <span className={styles.required}> *</span>
            </span>
          </label>

          <label className={styles.checkboxLabel}>
            <input type="checkbox" className={styles.checkbox}
              checked={lgpdConsent} onChange={e => setLgpdConsent(e.target.checked)} />
            <span className={styles.checkboxText}>
              Autorizo o uso dos meus dados conforme a Política de Privacidade (LGPD).
              <span className={styles.required}> *</span>
            </span>
          </label>

          <label className={styles.checkboxLabel}>
            <input type="checkbox" className={styles.checkbox}
              checked={pushConsent} onChange={e => setPushConsent(e.target.checked)} />
            <span className={styles.checkboxText}>
              Quero receber notificações quando uma atividade for processada.
              <span className={styles.checkboxHint}> Opcional.</span>
            </span>
          </label>
        </section>

        {error && <div className={styles.errorBox}>{error}</div>}

        <button
          className={`${styles.submitButton} ${!canSubmit || saving ? styles.submitDisabled : ""}`}
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
        >
          {saving ? "Salvando..." : "Confirmar pré-inscrição"}
        </button>

        <p className={styles.requiredNote}>
          <span className={styles.required}>*</span> campos obrigatórios
        </p>

      </div>
    </div>
  );
}
