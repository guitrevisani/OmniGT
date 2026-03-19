// src/app/[slug]/register/CampRegister.jsx
"use client";

import { useState, useEffect } from "react";
import styles from "./CampRegister.module.css";

const CONSENT_VERSION = "1.0";

export default function CampRegister({ slug, eventName }) {
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);
  const [eventData, setEventData] = useState(null);

  const [ftpW,            setFtpW]            = useState("");
  const [weightKg,        setWeightKg]        = useState("");
  const [hrMax,           setHrMax]           = useState("");
  const [hrZones,         setHrZones]         = useState(["", "", "", ""]);
  const [gender,          setGender]          = useState("");
  const [birthDate,       setBirthDate]       = useState("");
  const [email,           setEmail]           = useState("");
  const [whatsapp,        setWhatsapp]        = useState("");
  const [emergencyName,   setEmergencyName]   = useState("");
  const [emergencyPhone,  setEmergencyPhone]  = useState("");
  const [medicalClearance,  setMedicalClearance]  = useState(false);
  const [consentGiven,    setConsentGiven]    = useState(false);
  const [pushConsent,     setPushConsent]     = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/camp/${slug}/register`);
        if (!res.ok) throw new Error("Erro ao carregar dados");
        const data = await res.json();
        setEventData(data.event);

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

  const canSubmit =
    gender &&
    birthDate &&
    weightKg &&
    (email || whatsapp) &&
    medicalClearance &&
    consentGiven;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      const zonesPayload = hrZones.some(z => z !== "")
        ? [...hrZones.map(Number), hrMax ? Number(hrMax) : null].filter(Boolean)
        : null;

      const res = await fetch(`/api/camp/${slug}/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ftp_w:            ftpW      ? Number(ftpW)      : null,
          weight_kg:        weightKg  ? Number(weightKg)  : null,
          hr_max:           hrMax     ? Number(hrMax)     : null,
          hr_zones:         zonesPayload,
          gender,
          birth_date:       birthDate,
          email:            email     || null,
          whatsapp:         whatsapp  || null,
          emergency_name:   emergencyName  || null,
          emergency_phone:  emergencyPhone || null,
          medical_clearance: medicalClearance,
          consent_version:  CONSENT_VERSION,
          push_consent:     pushConsent,
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Erro ao salvar inscrição");
      }

      const oauthUrl = `/api/auth/strava/start?event=${slug}&push_consent=${pushConsent ? "1" : "0"}`;
      window.location.href = oauthUrl;

    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading)    return <div className={styles.loading}>Carregando...</div>;
  if (!eventData) return <div className={styles.loading}>Evento não encontrado.</div>;

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Cabeçalho ──────────────────────────────────── */}
        <div className={styles.header}>
          <span className={styles.headerBadge}>OGT Camp</span>
          <h1 className={styles.headerTitle}>{eventData.name}</h1>
          {eventData.location && (
            <p className={styles.headerMeta}>{eventData.location}</p>
          )}
        </div>

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
                value={ftpW} onChange={e => setFtpW(e.target.value)}
                placeholder="ex: 280" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Peso (kg) <span className={styles.required}>*</span>
              </span>
              <input className={styles.input} type="number" min="30" max="200" step="0.1"
                value={weightKg} onChange={e => setWeightKg(e.target.value)}
                placeholder="ex: 75" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>FC máx (bpm)</span>
              <input className={styles.input} type="number" min="100" max="230"
                value={hrMax} onChange={e => setHrMax(e.target.value)}
                placeholder="ex: 185" />
            </label>
          </div>

          <div className={styles.zonesGroup}>
            <span className={styles.fieldLabel}>Zonas de FC (bpm máx por zona)</span>
            <div className={styles.zonesRow}>
              {["Z1", "Z2", "Z3", "Z4"].map((z, i) => (
                <label key={z} className={styles.zoneField}>
                  <span className={styles.zoneLabel}>{z}</span>
                  <input className={styles.input} type="number" min="60" max="230"
                    value={hrZones[i]} onChange={e => updateHrZone(i, e.target.value)}
                    placeholder="—" />
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
              <span className={styles.fieldHint}>
                Usado exclusivamente para cálculos fisiológicos.
              </span>
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
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                WhatsApp{!email && <span className={styles.required}> *</span>}
              </span>
              <input className={styles.input} type="tel"
                value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
                placeholder="+55 11 99999-9999" />
            </label>
          </div>
          <p className={styles.fieldHint}>
            Informe ao menos um meio de contato para comunicações sobre o evento.
          </p>
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
          <label className={styles.checkboxLabel}>
            <input type="checkbox" className={styles.checkbox}
              checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} />
            <span className={styles.checkboxText}>
              Autorizo o acesso às minhas atividades no Strava e o uso dos dados pessoais
              informados neste formulário para participação neste evento. Os dados serão
              usados para calcular métricas, atualizar a descrição das atividades elegíveis
              e para comunicações relacionadas ao evento. Nenhuma informação é compartilhada
              com terceiros.
              <span className={styles.required}> *</span>
            </span>
          </label>

          <label className={styles.checkboxLabel}>
            <input type="checkbox" className={styles.checkbox}
              checked={pushConsent} onChange={e => setPushConsent(e.target.checked)} />
            <span className={styles.checkboxText}>
              Quero receber notificações quando uma atividade for processada.
              <span className={styles.checkboxHint}> Opcional — configurável no dashboard.</span>
            </span>
          </label>
        </section>

        {error && (
          <div className={styles.errorBox}>{error}</div>
        )}

        <button
          className={`${styles.submitButton} ${!canSubmit || saving ? styles.submitDisabled : ""}`}
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
        >
          {saving ? "Salvando..." : "Confirmar inscrição via Strava"}
        </button>

        <p className={styles.requiredNote}>
          <span className={styles.required}>*</span> campos obrigatórios
        </p>

      </div>
    </div>
  );
}
