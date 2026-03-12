"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ─── Constantes físicas (não configuráveis) ───────────────────────────────────
const RHO    = 1.2;
const G      = 9.81;
const ETA    = 0.97;
const K_ROLL = 0.5;
const GRADE_UP = 0.03;
const GRADE_DN = -0.03;

// ─── Física ───────────────────────────────────────────────────────────────────

function wattsToSpeedKmh(watts, gradeFraction, windMps = 0, cfg) {
  const { mass_kg, cda, crr } = cfg;
  let lo = 0.1, hi = 80;
  for (let i = 0; i < 60; i++) {
    const v = (lo + hi) / 2, vMs = v / 3.6, vr = vMs + windMps;
    const Ptot = (crr * mass_kg * G * Math.cos(Math.atan(gradeFraction)) * vMs
                + mass_kg * G * Math.sin(Math.atan(gradeFraction)) * vMs
                + 0.5 * cda * RHO * vr * vr * vMs) / ETA;
    if (Ptot < watts) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}

function ifZones(wkg, ftpW, cfg) {
  const IF = wkg / (ftpW / cfg.mass_kg);
  if (IF <= 0.85) return [{ frac: 1.0,  watts: wkg * cfg.mass_kg }];
  if (IF <= 0.95) return [{ frac: 0.80, watts: 0.85 * ftpW }, { frac: 0.20, watts: 0.60 * ftpW }];
  if (IF <= 1.05) return [{ frac: 0.50, watts: 1.00 * ftpW }, { frac: 0.50, watts: 0.60 * ftpW }];
  return [{ frac: 0.16, watts: 1.05 * ftpW }, { frac: 0.64, watts: 0.50 * ftpW }, { frac: 0.20, watts: 0.60 * ftpW }];
}

function ifLabel(wkg, ftpW, cfg) {
  const IF = wkg / (ftpW / cfg.mass_kg);
  if (IF <= 0.6)  return { label: "REGENERATIVO", color: "#4db6ac" };
  if (IF <= 0.75) return { label: "ENDURANCE",    color: "#8bc34a" };
  if (IF <= 0.95) return { label: "FORTE/LIMIAR", color: "#ffc107" };
  if (IF <= 1.05) return { label: "MÁXIMO",       color: "#ff1744" };
  return               { label: "HIIT",           color: "#7e0b22" };
}

// ─── GPX ──────────────────────────────────────────────────────────────────────

function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const name =
    doc.querySelector("trk > name")?.textContent?.trim() ||
    doc.querySelector("metadata > name")?.textContent?.trim() ||
    doc.querySelector("name")?.textContent?.trim() ||
    "Rota sem nome";
  const pts = [...doc.querySelectorAll("trkpt")];
  if (pts.length < 2) throw new Error("GPX sem pontos suficientes.");
  return {
    name,
    points: pts.map(pt => ({
      lat: parseFloat(pt.getAttribute("lat")),
      lon: parseFloat(pt.getAttribute("lon")),
      ele: parseFloat(pt.querySelector("ele")?.textContent ?? "0"),
    })),
  };
}

function haversineKm(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

function buildSegments(points) {
  const segs = [];
  let sector = 0, gain = 0;
  for (let i = 1; i < points.length; i++) {
    const dM    = haversineKm(points[i-1], points[i]) * 1000;
    const slope = points[i].ele - points[i-1].ele;
    sector += dM;
    gain   += slope;
    if (sector > 100) {
      const gf = gain / sector;
      segs.push({ distanceM: sector, gainM: gain, gf, gradePct: gf * 100,
        type: gf <= GRADE_DN ? "descent" : gf >= GRADE_UP ? "climb" : "flat",
        startEle: points[i-1].ele, endEle: points[i].ele });
      sector = 0; gain = 0;
    }
  }
  if (sector > 0) {
    const gf = gain / sector;
    segs.push({ distanceM: sector, gainM: gain, gf, gradePct: gf * 100,
      type: gf <= GRADE_DN ? "descent" : gf >= GRADE_UP ? "climb" : "flat",
      startEle: points[points.length - 2].ele, endEle: points[points.length - 1].ele });
  }
  return segs;
}

// ─── Cálculo de tempo ─────────────────────────────────────────────────────────

function calculateTime(segs, wkg, ftpW, windMps = 0, cfg) {
  const zones = ifZones(wkg, ftpW, cfg);
  let flatMin = 0, upMin = 0, downMin = 0;
  for (const seg of segs) {
    const km    = seg.distanceM / 1000;
    const effGf = seg.gf * K_ROLL;
    if (seg.type === "descent") {
      const descSpd = Math.min(
        wattsToSpeedKmh(wkg * cfg.mass_kg, effGf, windMps, cfg),
        Math.max(20, cfg.descent_kmh - windMps * 2)
      );
      downMin += km / descSpd * 60;
    } else if (seg.type === "climb") {
      upMin += km / wattsToSpeedKmh(wkg * cfg.mass_kg, effGf, windMps, cfg) * 60;
    } else {
      for (const z of zones) {
        flatMin += z.frac * (km / wattsToSpeedKmh(z.watts, effGf, windMps, cfg)) * 60;
      }
    }
  }
  const rawMin    = flatMin + upMin + downMin;
  const movingMin = Math.ceil(rawMin / 15) * 15;
  const breakMin  = Math.floor(movingMin / 120) * 15;
  const totalKm   = segs.reduce((s, g) => s + g.distanceM, 0) / 1000;
  return { movingMin, totalMin: movingMin + breakMin, flatMin, upMin, downMin, rawMin,
           avgSpeedKmh: totalKm / (rawMin / 60), zones, IF: wkg / (ftpW / cfg.mass_kg) };
}

function formatTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2,"0")}min` : `${m}min`;
}

// ─── Categorização de subidas (critério Strava) ───────────────────────────────

function climbCategory(lengthM, avgGradePct) {
  const score = lengthM * avgGradePct;
  if (score >= 80000) return { cat: "HC", color: "#ff1744", order: 5 };
  if (score >= 64000) return { cat: "1",  color: "#ff5722", order: 4 };
  if (score >= 32000) return { cat: "2",  color: "#ff9800", order: 3 };
  if (score >= 16000) return { cat: "3",  color: "#ffc107", order: 2 };
  if (score >=  8000) return { cat: "4",  color: "#8bc34a", order: 1 };
  return null;
}

function detectMajorClimbs(segs) {
  const climbs = [];
  let inClimb = false, cGain = 0, cLen = 0, cStartKm = 0, distKm = 0;
  for (const seg of segs) {
    if (seg.type === "climb") {
      if (!inClimb) { inClimb = true; cStartKm = distKm; cGain = 0; cLen = 0; }
      cGain += seg.gainM; cLen += seg.distanceM;
    } else if (inClimb) {
      if (cLen >= 500) {
        const avgGrade = (cGain / cLen) * 100;
        const cat = climbCategory(cLen, avgGrade);
        if (cat) climbs.push({
          startKm: cStartKm, endKm: distKm,
          gainM: Math.round(cGain), lengthKm: +(cLen/1000).toFixed(1),
          avgGrade: +avgGrade.toFixed(1),
          score: Math.round(cLen * avgGrade),
          ...cat,
        });
      }
      inClimb = false;
    }
    distKm += seg.distanceM / 1000;
  }
  return climbs.sort((a, b) => b.score - a.score);
}

// ─── Cor por declive ──────────────────────────────────────────────────────────

function gradeToColor(pct) {
  if (pct > 15) return "#34050e"; if (pct > 12) return "#b81135";
  if (pct > 9)  return "#ff1744"; if (pct > 6)  return "#ffc107";
  if (pct > 3)  return "#8bc34a"; if (pct > -3) return "#4db6ac";
  if (pct > -6) return "#1976d2"; if (pct > -9) return "#7b1fa2";
  return "#340d44";
}

const LEGEND = [
  { label:"> 15%",  color:"#34050e" }, { label:"12–15%", color:"#b81135" },
  { label:"9–12%",  color:"#ff1744" }, { label:"6–9%",   color:"#ffc107" },
  { label:"3–6%",   color:"#8bc34a" }, { label:"Plano",  color:"#4db6ac" },
  { label:"−3–6%",  color:"#1976d2" }, { label:"−6–9%",  color:"#7b1fa2" },
  { label:"> −9%",  color:"#340d44" },
];

// ─── Canvas: perfil altimétrico ───────────────────────────────────────────────

function ElevationChart({ segments, climbs }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !segments.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const P = { top: 28, right: 20, bottom: 44, left: 56 };
    const cW = W - P.left - P.right, cH = H - P.top - P.bottom;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0f1117"; ctx.fillRect(0, 0, W, H);

    const pts = [{ d: 0, e: segments[0].startEle }];
    let dist = 0;
    for (const seg of segments) { dist += seg.distanceM; pts.push({ d: dist, e: seg.endEle }); }
    const maxD = pts[pts.length-1].d;
    const eles = pts.map(p => p.e);
    const minE = Math.min(...eles), maxE = Math.max(...eles), rangeE = maxE - minE || 1;
    const xOf = d => P.left + (d / maxD) * cW;
    const yOf = e => P.top + cH - ((e - minE) / rangeE) * cH;

    for (let i = 0; i <= 4; i++) {
      const y = P.top + (i/4) * cH;
      ctx.strokeStyle = "#1e2130"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(P.left, y); ctx.lineTo(P.left + cW, y); ctx.stroke();
      ctx.fillStyle = "#4a5568"; ctx.font = "11px monospace"; ctx.textAlign = "right";
      ctx.fillText(Math.round(maxE - (i/4) * rangeE) + "m", P.left - 6, y + 4);
    }
    const kmStep = maxD > 80000 ? 10000 : maxD > 30000 ? 5000 : 2000;
    for (let d = 0; d <= maxD; d += kmStep) {
      ctx.fillStyle = "#4a5568"; ctx.font = "11px monospace"; ctx.textAlign = "center";
      ctx.fillText((d/1000).toFixed(0) + "km", xOf(d), H - P.bottom + 16);
    }
    for (let i = 0; i < segments.length; i++) {
      const x0 = xOf(pts[i].d), x1 = xOf(pts[i+1].d);
      const y0 = yOf(pts[i].e), y1 = yOf(pts[i+1].e), yBase = P.top + cH;
      const color = gradeToColor(segments[i].gradePct);
      ctx.beginPath();
      ctx.moveTo(x0, yBase); ctx.lineTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, yBase);
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, P.top, 0, yBase);
      gr.addColorStop(0, color + "cc"); gr.addColorStop(1, color + "22");
      ctx.fillStyle = gr; ctx.fill();
    }
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(xOf(p.d), yOf(p.e)) : ctx.lineTo(xOf(p.d), yOf(p.e)));
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1.5; ctx.stroke();
    for (const c of climbs) {
      const x = xOf(c.startKm * 1000);
      ctx.setLineDash([4,4]); ctx.strokeStyle = c.color + "88"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, P.top); ctx.lineTo(x, P.top + cH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.color; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
      ctx.fillText((c.cat === "HC" ? "HC" : "C" + c.cat) + " +" + c.gainM + "m", x + 3, P.top + 14);
    }
  }, [segments, climbs]);
  return <canvas ref={canvasRef} width={900} height={270} style={{ width:"100%", height:"auto", borderRadius:8 }} />;
}

// ─── Controle W/kg + FTP ──────────────────────────────────────────────────────
// FTP é editado aqui — único campo de FTP na UI.

function WkgControl({ value, onChange, ftpW, onFtpChange, cfg }) {
  const [wkgTxt, setWkgTxt] = useState(value.toFixed(1));
  const [ftpTxt, setFtpTxt] = useState(String(ftpW));
  useEffect(() => setWkgTxt(value.toFixed(1)), [value]);
  useEffect(() => setFtpTxt(String(ftpW)), [ftpW]);

  const commitWkg = v => { const n = parseFloat(v); if (!isNaN(n)) onChange(Math.min(6, Math.max(1, Math.round(n*10)/10))); };
  const commitFtp = v => { const n = parseInt(v, 10); if (!isNaN(n) && n >= 50 && n <= 600) onFtpChange(n); };
  const step = d => onChange(Math.min(6, Math.max(1, Math.round((value + d) * 10) / 10)));
  const { label: zLabel, color: zColor } = ifLabel(value, ftpW, cfg);

  return (
    <div>
      <style>{`
        input[type=range]{appearance:none;background:transparent;width:100%;height:24px;cursor:pointer}
        input[type=range]::-webkit-slider-thumb{appearance:none;width:18px;height:18px;border-radius:50%;
          background:#e2e8f0;border:2px solid #63b3ed;cursor:pointer;box-shadow:0 0 6px #63b3ed88}
        .sb{width:26px;height:30px;background:#141820;border:1px solid #2d3748;color:#a0aec0;
          cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center}
        .sb:hover{background:#1e2537}
      `}</style>

      {/* FTP — único campo de FTP na UI */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14,
        paddingBottom:14, borderBottom:"1px solid #1e2130" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#4a5568", letterSpacing:1 }}>FTP</div>
        <input value={ftpTxt}
          onChange={e => setFtpTxt(e.target.value)}
          onBlur={e => commitFtp(e.target.value)}
          onKeyDown={e => e.key === "Enter" && commitFtp(ftpTxt)}
          style={{ width:68, textAlign:"center", background:"#141820", border:"1px solid #2d3748",
            borderRadius:6, color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:15, fontWeight:600, padding:"4px 0" }}
        />
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#4a5568" }}>W</div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568" }}>
          · {(ftpW / cfg.mass_kg).toFixed(2)} w/kg · {cfg.mass_kg}kg sistema
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#4a5568", letterSpacing:1 }}>INTENSIDADE (W/KG)</div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:zColor, letterSpacing:1,
          padding:"2px 10px", border:`1px solid ${zColor}44`, borderRadius:4, background:zColor+"11" }}>
          {zLabel} · IF {(value / (ftpW / cfg.mass_kg)).toFixed(2)}
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:20 }}>
        <div style={{ flex:1, position:"relative" }}>
          <div style={{ position:"absolute", top:"50%", left:0, right:0, height:6,
            transform:"translateY(-50%)", borderRadius:3, pointerEvents:"none",
            background:"linear-gradient(90deg,#4db6ac,#8bc34a,#ffc107,#ff5722,#7e0b22)" }} />
          <input type="range" min="1" max="6" step="0.1" value={value} onChange={e => onChange(parseFloat(e.target.value))} />
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:2 }}>
            {["Regen","Endurance","Forte","Máximo","HIIT"].map(l => (
              <div key={l} style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#4a5568", flex:1, textAlign:"center" }}>{l}</div>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, minWidth:110 }}>
          <div style={{ display:"flex" }}>
            <button className="sb" style={{ borderRadius:"4px 0 0 4px" }} onClick={() => step(-0.1)}>−</button>
            <input value={wkgTxt}
              onChange={e => setWkgTxt(e.target.value)}
              onBlur={e => commitWkg(e.target.value)}
              onKeyDown={e => e.key === "Enter" && commitWkg(wkgTxt)}
              style={{ width:58, textAlign:"center", background:"#141820", border:"1px solid #2d3748",
                borderLeft:"none", borderRight:"none", color:"#e2e8f0",
                fontFamily:"'DM Mono',monospace", fontSize:17, fontWeight:600 }} />
            <button className="sb" style={{ borderRadius:"0 4px 4px 0" }} onClick={() => step(+0.1)}>+</button>
          </div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#4a5568" }}>
            {(value * cfg.mass_kg).toFixed(0)}W · {value.toFixed(1)} w/kg
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Painel de parâmetros do sistema ─────────────────────────────────────────
// FTP não aparece aqui — está no WkgControl acima.
// CdA e Crr visíveis mas desabilitados (evolução futura).

function ConfigPanel({ cfg }) {
  const fields = [
    { key:"mass_kg",     label:"MASSA (kg - ciclista + equipamento)", enabled: true  },
    { key:"descent_kmh", label:"VEL. DESCIDA (km/h)",                 enabled: true  },
    { key:"cda",         label:"CdA (m²)",                            enabled: false },
    { key:"crr",         label:"Crr",                                 enabled: false },
  ];

  return (
    <div style={{ background:"#0d1117", border:"1px solid #1e2130", borderRadius:12,
      padding:"14px 18px", marginBottom:16 }}>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568",
        letterSpacing:1, marginBottom:12 }}>⚙ PARÂMETROS DO SISTEMA</div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {fields.map(f => (
          <div key={f.key} style={{ display:"flex", alignItems:"center", gap:12,
            opacity: f.enabled ? 1 : 0.35 }}>
            <div style={{ flex:1, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#718096" }}>
              {f.label}
            </div>
            <input
              defaultValue={cfg[f.key]}
              disabled={!f.enabled}
              style={{ width:72, textAlign:"center", background:"#141820",
                border:`1px solid ${f.enabled ? "#2d3748" : "#1a1e2a"}`,
                borderRadius:6, color: f.enabled ? "#e2e8f0" : "#4a5568",
                fontFamily:"'DM Mono',monospace", fontSize:13, padding:"3px 0",
                cursor: f.enabled ? "text" : "not-allowed" }}
            />
          </div>
        ))}
      </div>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#2d3748", marginTop:10 }}>
        CdA e Crr serão configuráveis em versão futura
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function EstimatorDashboard({ slug, eventName }) {
  const [cfg,        setCfg]        = useState(null);
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [routeData,  setRouteData]  = useState(null);
  const [segments,   setSegments]   = useState([]);
  const [climbs,     setClimbs]     = useState([]);
  const [wkg,        setWkg]        = useState(2.0);
  const [ftpW,       setFtpW]       = useState(260);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState("");
  const [dragging,   setDragging]   = useState(false);
  const [fileName,   setFileName]   = useState("");
  const [exporting,  setExporting]  = useState(false);
  const windMps = 0;

  // ── Carregar configs do evento ──────────────────────────────
  useEffect(() => {
    fetch(`/api/estimator/${slug}`)
      .then(r => r.json())
      .then(data => {
        if (data.config) {
          setCfg(data.config);
          setFtpW(data.config.default_ftp_w);
        }
      })
      .catch(() => setCfg({ mass_kg:85, default_ftp_w:260, descent_kmh:45, cda:0.32, crr:0.004 }))
      .finally(() => setLoadingCfg(false));
  }, [slug]);

  const processFile = useCallback(file => {
    if (!file?.name.toLowerCase().endsWith(".gpx")) { setError("Selecione um arquivo .gpx válido."); return; }
    setFileName(file.name); setError("");
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const { name, points } = parseGpx(e.target.result);
        const segs = buildSegments(points);
        setRouteData({ name }); setSegments(segs); setClimbs(detectMajorClimbs(segs));
      } catch (err) { setError("Erro ao processar GPX: " + err.message); }
    };
    reader.readAsText(file);
  }, []);

  useEffect(() => {
    if (segments.length && cfg) setResult(calculateTime(segments, wkg, ftpW, windMps, cfg));
  }, [segments, wkg, ftpW, windMps, cfg]);

  const totalKm   = segments.reduce((s, g) => s + g.distanceM, 0) / 1000;
  const totalGain = segments.reduce((s, g) => s + Math.max(0, g.gainM), 0);

  // ── Exportar imagem ─────────────────────────────────────────
  const exportImage = useCallback(() => {
    if (!result || !routeData || !cfg) return;
    setExporting(true);

    const { label: zLabel, color: zColor } = ifLabel(wkg, ftpW, cfg);
    const PAD = 60, W = 1080;
    const H_HEADER  = 210;
    const H_CARDS   = 160;
    const H_ZONE    = 56;
    const H_PROFILE = 220;
    const H_CLIMBS  = climbs.length > 0 ? 50 + Math.ceil(climbs.length / 2) * 60 : 0;
    const H_FOOTER  = 36;
    const H = H_HEADER + H_CARDS + H_ZONE + H_PROFILE + H_CLIMBS + H_FOOTER;

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    const rr = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
      ctx.lineTo(x+w, y+h-r);   ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
      ctx.lineTo(x+r, y+h);     ctx.arcTo(x, y+h, x, y+h-r, r);
      ctx.lineTo(x, y+r);       ctx.arcTo(x, y, x+r, y, r);
      ctx.closePath();
    };

    // Fundo
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0d1117"); bg.addColorStop(1, "#0a0c12");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Barra superior
    const topBar = ctx.createLinearGradient(0, 0, W, 0);
    topBar.addColorStop(0, "#63b3ed"); topBar.addColorStop(1, "#29b6f6");
    ctx.fillStyle = topBar; ctx.fillRect(0, 0, W, 5);

    // Nome da rota
    ctx.fillStyle = "#63b3ed"; ctx.font = "bold 46px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(routeData.name, PAD, 72);

    // Zona badge
    ctx.fillStyle = zColor; ctx.font = "bold 15px monospace";
    ctx.fillText(`${zLabel}  ·  ${wkg.toFixed(1)} w/kg  ·  FTP ${ftpW}W  ·  ${cfg.mass_kg}kg`, PAD, 104);

    // Stats
    const stats = [
      ["DISTÂNCIA",   totalKm.toFixed(1) + " km"],
      ["GANHO ALT.",  Math.round(totalGain) + " m"],
      ["VMED GLOBAL", result.avgSpeedKmh.toFixed(1) + " km/h"],
      ["FATOR IF",    result.IF.toFixed(2)],
      ["SUBIDAS",     climbs.length + " principais"],
    ];
    const colW = (W - PAD * 2) / stats.length;
    stats.forEach(([label, val], i) => {
      const x = PAD + i * colW;
      ctx.fillStyle = "#4a5568"; ctx.font = "12px monospace"; ctx.textAlign = "left";
      ctx.fillText(label, x, 148);
      ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 20px sans-serif";
      ctx.fillText(val, x, 174);
    });
    ctx.strokeStyle = "#1e2130"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, 196); ctx.lineTo(W-PAD, 196); ctx.stroke();

    // Time cards
    let cy = H_HEADER;
    const cardW = (W - PAD * 2 - 16) / 2;
    const drawCard = (x, y, w, h, bc, label, time, sub) => {
      ctx.fillStyle = bc + "11"; rr(ctx, x, y, w, h, 12); ctx.fill();
      ctx.strokeStyle = bc; ctx.lineWidth = 1.5; rr(ctx, x, y, w, h, 12); ctx.stroke();
      ctx.fillStyle = bc + "cc"; ctx.font = "12px monospace"; ctx.textAlign = "left";
      ctx.fillText(label, x+18, y+28);
      ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 60px sans-serif";
      ctx.fillText(time, x+18, y+98);
      ctx.fillStyle = "#4a5568"; ctx.font = "11px monospace";
      ctx.fillText(sub, x+18, y+122);
    };
    drawCard(PAD, cy, cardW, H_CARDS-16, "#29b6f6",
      "TEMPO EM MOVIMENTO", formatTime(result.movingMin),
      `up ${result.upMin.toFixed(0)}min  flat ${result.flatMin.toFixed(0)}min  dn ${result.downMin.toFixed(0)}min`);
    drawCard(PAD+cardW+16, cy, cardW, H_CARDS-16, "#f6ad55",
      "TEMPO TOTAL", formatTime(result.totalMin),
      `+${result.totalMin - result.movingMin}min paradas  ·  ${Math.floor(result.movingMin/120)}x 15min/2h`);

    // Zone strip
    cy += H_CARDS;
    ctx.fillStyle = zColor + "18"; rr(ctx, PAD, cy, W-PAD*2, 36, 8); ctx.fill();
    ctx.strokeStyle = zColor + "55"; ctx.lineWidth = 1; rr(ctx, PAD, cy, W-PAD*2, 36, 8); ctx.stroke();
    ctx.fillStyle = zColor; ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
    ctx.fillText(`ZONA: ${zLabel}   IF ${result.IF.toFixed(2)}`, W/2, cy+23);

    // Elevation profile
    cy += H_ZONE;
    const offY = cy, cH2 = H_PROFILE - 44, cW2 = W - PAD * 2;
    const pts2 = [{ d:0, e: segments[0].startEle }];
    let d2 = 0;
    for (const seg of segments) { d2 += seg.distanceM; pts2.push({ d:d2, e:seg.endEle }); }
    const maxD2 = pts2[pts2.length-1].d;
    const eles2 = pts2.map(p => p.e);
    const minE2 = Math.min(...eles2), maxE2 = Math.max(...eles2), rE2 = maxE2 - minE2 || 1;
    const xOf2 = d => PAD + (d / maxD2) * cW2;
    const yOf2 = e => offY + cH2 - ((e - minE2) / rE2) * cH2;

    for (let i = 0; i < segments.length; i++) {
      const x0 = xOf2(pts2[i].d), x1 = xOf2(pts2[i+1].d);
      const y0 = yOf2(pts2[i].e), y1 = yOf2(pts2[i+1].e), yBase = offY + cH2;
      const color = gradeToColor(segments[i].gradePct);
      ctx.beginPath();
      ctx.moveTo(x0, yBase); ctx.lineTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, yBase);
      ctx.closePath();
      const gr2 = ctx.createLinearGradient(0, offY, 0, yBase);
      gr2.addColorStop(0, color + "cc"); gr2.addColorStop(1, color + "22");
      ctx.fillStyle = gr2; ctx.fill();
    }
    ctx.beginPath();
    pts2.forEach((p, i) => i === 0 ? ctx.moveTo(xOf2(p.d), yOf2(p.e)) : ctx.lineTo(xOf2(p.d), yOf2(p.e)));
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1.5; ctx.stroke();

    for (const c of climbs) {
      const x = xOf2(c.startKm * 1000);
      ctx.setLineDash([3,3]); ctx.strokeStyle = c.color + "88"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, offY); ctx.lineTo(x, offY + cH2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.color; ctx.font = "bold 9px monospace"; ctx.textAlign = "left";
      ctx.fillText((c.cat === "HC" ? "HC" : "C" + c.cat) + " +" + c.gainM + "m", x + 2, offY + 12);
    }

    // Climbs list
    cy += H_PROFILE;
    if (climbs.length > 0) {
      ctx.fillStyle = "#4a5568"; ctx.font = "11px monospace"; ctx.textAlign = "left";
      ctx.fillText("SUBIDAS CATEGORIZADAS (CRITÉRIO STRAVA)", PAD, cy + 14);
      cy += 28;
      const itemW = (W - PAD * 2 - 12) / 2;
      climbs.forEach((c, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = PAD + col * (itemW + 12), y = cy + row * 58;
        ctx.strokeStyle = c.color + "44"; ctx.lineWidth = 1;
        rr(ctx, x, y, itemW, 50, 8); ctx.stroke();
        ctx.fillStyle = c.color + "22"; rr(ctx, x, y, itemW, 50, 8); ctx.fill();
        ctx.fillStyle = c.color; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "left";
        ctx.fillText(c.cat === "HC" ? "HC" : "C" + c.cat, x + 12, y + 30);
        ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 13px sans-serif";
        ctx.fillText(`+${c.gainM}m  ·  ${c.avgGrade}%  ·  ${c.lengthKm}km`, x + 60, y + 20);
        ctx.fillStyle = "#718096"; ctx.font = "11px monospace";
        ctx.fillText(`km ${c.startKm.toFixed(1)} > ${c.endKm.toFixed(1)}  score ${c.score.toLocaleString()}`, x + 60, y + 38);
      });
    }

    // Footer
    ctx.fillStyle = "#e2e8f0"; ctx.font = "13px monospace"; ctx.textAlign = "right";
    ctx.fillText("OGT · OMNI GT", W - PAD, H - 12);

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = (routeData.name.replace(/\s+/g, "_") || "rota") + "_estimativa.png";
    a.click();
    setExporting(false);
  }, [result, routeData, wkg, ftpW, climbs, segments, totalKm, totalGain, cfg]);

  // ── Loading ─────────────────────────────────────────────────
  if (loadingCfg) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      minHeight:"60vh", background:"#0a0c12" }}>
      <div style={{ width:32, height:32, border:"3px solid rgba(99,179,237,0.2)",
        borderTop:"3px solid #63b3ed", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const { label: zoneLabel, color: zoneColor } = cfg ? ifLabel(wkg, ftpW, cfg) : { label:"", color:"#fff" };

  return (
    <div style={{ minHeight:"100vh", background:"#0a0c12", color:"#e2e8f0",
      fontFamily:"'DM Sans',sans-serif", paddingBottom:60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#0a0c12}
        ::-webkit-scrollbar-thumb{background:#2d3748;border-radius:3px}
        .dz{transition:all .2s ease}.dz:hover{border-color:#63b3ed!important;background:#0d1520!important}
        @keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .fu{animation:fu .35s ease forwards}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* Header */}
      <div style={{ background:"#0d1117", borderBottom:"1px solid #1e2130", padding:"16px 28px",
        display:"flex", alignItems:"center", gap:14 }}>
        <span style={{ fontSize:24 }}>🚴</span>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, letterSpacing:2,
            color:"#63b3ed", lineHeight:1 }}>OGT ESTIMATOR</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568", marginTop:2, letterSpacing:1 }}>
            FÍSICA k={K_ROLL} · FTP {ftpW}W · {cfg?.mass_kg}KG SISTEMA
          </div>
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"0 auto", padding:"24px 18px" }}>

        {/* Drop zone */}
        <div className="dz"
          onDrop={e => { e.preventDefault(); setDragging(false); processFile(e.dataTransfer.files[0]); }}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => document.getElementById("gpx-in").click()}
          style={{ border:`2px dashed ${dragging?"#63b3ed":"#2d3748"}`, borderRadius:12,
            padding:"28px 20px", textAlign:"center", cursor:"pointer",
            background:dragging?"#0d1520":"#0d1117", marginBottom:16 }}>
          <input id="gpx-in" type="file" accept=".gpx" style={{ display:"none" }}
            onChange={e => processFile(e.target.files[0])} />
          <div style={{ fontSize:28, marginBottom:4 }}>📂</div>
          <div style={{ fontSize:13, color:"#a0aec0" }}>
            {fileName || "Arraste um arquivo .gpx ou clique para selecionar"}
          </div>
          {fileName && (
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568", marginTop:3 }}>
              {fileName}
            </div>
          )}
        </div>

        {error && (
          <div style={{ background:"#2d1515", border:"1px solid #fc8181", borderRadius:8,
            padding:"10px 14px", color:"#fc8181", marginBottom:14,
            fontFamily:"'DM Mono',monospace", fontSize:12 }}>
            ⚠ {error}
          </div>
        )}

        {/* W/kg + FTP */}
        {cfg && (
          <div style={{ background:"#0d1117", border:"1px solid #1e2130", borderRadius:12,
            padding:"16px 20px", marginBottom:16 }}>
            <WkgControl value={wkg} onChange={setWkg} ftpW={ftpW} onFtpChange={setFtpW} cfg={cfg} />
          </div>
        )}

        {/* Parâmetros do sistema */}
        {cfg && <ConfigPanel cfg={cfg} />}

        {/* Resultados */}
        {segments.length > 0 && result && cfg && (
          <div className="fu">

            {/* Botão exportar */}
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
              <button onClick={exportImage} disabled={exporting}
                style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 18px",
                  background:exporting?"#141820":"#0d2137",
                  border:"1px solid #29b6f6", borderRadius:8, color:"#29b6f6",
                  fontFamily:"'DM Mono',monospace", fontSize:12,
                  cursor:exporting?"wait":"pointer", letterSpacing:1 }}>
                {exporting ? "⏳ GERANDO..." : "📷 COMPARTILHAR"}
              </button>
            </div>

            {/* Stats bar */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#63b3ed", letterSpacing:1 }}>
                {routeData?.name}
              </div>
              <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                {[
                  { l:"DISTÂNCIA",   v:totalKm.toFixed(1)+" km" },
                  { l:"GANHO ALT.",  v:Math.round(totalGain)+" m" },
                  { l:"VMÉD GLOBAL", v:result.avgSpeedKmh.toFixed(1)+" km/h" },
                  { l:"FATOR IF",    v:result.IF.toFixed(2) },
                  { l:"SUBIDAS",     v: climbs.length > 0
                      ? climbs.filter(c=>c.cat==="HC").length > 0
                        ? `HC×${climbs.filter(c=>c.cat==="HC").length} +` + ["1","2","3","4"].map(cat=>{const n=climbs.filter(c=>c.cat===cat).length; return n?`C${cat}×${n}`:""}).filter(Boolean).join(" ")
                        : ["1","2","3","4"].map(cat=>{const n=climbs.filter(c=>c.cat===cat).length; return n?`C${cat}×${n}`:""}).filter(Boolean).join(" ") || climbs.length+" cat."
                      : "nenhuma" },
                ].map(s => (
                  <div key={s.l} style={{ background:"#0a0c12", border:"1px solid #1e2130",
                    borderRadius:8, padding:"8px 14px" }}>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568", letterSpacing:1 }}>{s.l}</div>
                    <div style={{ fontSize:15, fontWeight:600, marginTop:2 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Time cards */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              <div style={{ background:"linear-gradient(135deg,#0d2137,#0a1a2e)",
                border:"1px solid #29b6f6", borderRadius:12, padding:"18px 22px" }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#29b6f6",
                  letterSpacing:1, marginBottom:4 }}>⏱ TEMPO EM MOVIMENTO</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:48, color:"#e2e8f0", lineHeight:1 }}>
                  {formatTime(result.movingMin)}
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568",
                  marginTop:8, display:"flex", gap:12, flexWrap:"wrap" }}>
                  <span>▲ {result.upMin.toFixed(0)}min subida</span>
                  <span>→ {result.flatMin.toFixed(0)}min plano</span>
                  <span>▼ {result.downMin.toFixed(0)}min descida</span>
                </div>
              </div>
              <div style={{ background:"linear-gradient(135deg,#1a1a0d,#121209)",
                border:"1px solid #f6ad55", borderRadius:12, padding:"18px 22px" }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f6ad55",
                  letterSpacing:1, marginBottom:4 }}>🕐 TEMPO TOTAL</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:48, color:"#e2e8f0", lineHeight:1 }}>
                  {formatTime(result.totalMin)}
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568", marginTop:8 }}>
                  +{result.totalMin - result.movingMin}min paradas · {Math.floor(result.movingMin/120)}× 15min/2h
                </div>
              </div>
            </div>

            {/* Zone distribution */}
            <div style={{ background:"#0d1117", border:`1px solid ${zoneColor}44`,
              borderRadius:12, padding:"14px 18px", marginBottom:14 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568",
                letterSpacing:1, marginBottom:10 }}>DISTRIBUIÇÃO DE ESFORÇO · {zoneLabel}</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {result.zones.map((z, i) => (
                  <div key={i} style={{ flex:1, minWidth:140, background:"#0a0c12",
                    border:"1px solid #1e2130", borderRadius:8, padding:"10px 14px" }}>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568" }}>
                      {Math.round(z.frac*100)}% DO TEMPO NO PLANO
                    </div>
                    <div style={{ fontSize:15, fontWeight:600, marginTop:4, color:zoneColor }}>
                      {z.watts.toFixed(0)}W
                    </div>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#718096", marginTop:2 }}>
                      IF {(z.watts/ftpW).toFixed(2)} · ~{wattsToSpeedKmh(z.watts, 0, 0, cfg).toFixed(0)} km/h plano
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Elevation chart */}
            <div style={{ background:"#0d1117", border:"1px solid #1e2130", borderRadius:12,
              padding:"14px", marginBottom:12 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568",
                letterSpacing:1, marginBottom:10 }}>PERFIL ALTIMÉTRICO · GRADIENTE DE INCLINAÇÃO</div>
              <ElevationChart segments={segments} climbs={climbs} />
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10 }}>
                {LEGEND.map(l => (
                  <div key={l.label} style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ width:10, height:10, borderRadius:2, background:l.color }} />
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#718096" }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Major climbs */}
            {climbs.length > 0 && (
              <div style={{ background:"#0d1117", border:"1px solid #1e2130", borderRadius:12,
                padding:"14px", marginBottom:12 }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568",
                  letterSpacing:1, marginBottom:10 }}>▲ SUBIDAS CATEGORIZADAS · CRITÉRIO STRAVA</div>
                {climbs.map((c, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px",
                    background:"#0a0c12", borderRadius:8, border:`1px solid ${c.color}33`,
                    marginBottom: i < climbs.length-1 ? 6 : 0 }}>
                    <div style={{ minWidth:44, height:44, borderRadius:8,
                      background: c.color + "22", border:`1px solid ${c.color}66`,
                      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:c.color, letterSpacing:1 }}>CAT</div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:c.color, lineHeight:1 }}>
                        {c.cat}
                      </div>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#718096", marginBottom:4 }}>
                        km {c.startKm.toFixed(1)} → {c.endKm.toFixed(1)}
                        <span style={{ marginLeft:10, color:"#4a5568" }}>score {c.score.toLocaleString()}</span>
                      </div>
                      <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                        {[["EXTENSÃO", c.lengthKm+" km"],["GANHO","+"+c.gainM+" m"],["MÉDIA",c.avgGrade+"%"]].map(([l,v]) => (
                          <span key={l} style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>
                            <span style={{ color:"#4a5568" }}>{l}: </span>
                            <span style={{ color:"#e2e8f0", fontWeight:500 }}>{v}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ width:4, alignSelf:"stretch", borderRadius:2, background:c.color }} />
                  </div>
                ))}
              </div>
            )}

            {/* Weather placeholder */}
            <div style={{ background:"#0a0d14", border:"1px dashed #2d3748", borderRadius:10,
              padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:16 }}>🌦</span>
              <div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4a5568", letterSpacing:1 }}>
                  INTEGRAÇÃO METEOROLÓGICA
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#2d3748", marginTop:2 }}>
                  windMps → afeta plano (aero) e descidas · hook pronto em calculateTime()
                </div>
              </div>
              <div style={{ marginLeft:"auto", padding:"2px 8px", background:"#1a1f2e",
                border:"1px solid #2d3748", borderRadius:4, fontFamily:"'DM Mono',monospace",
                fontSize:9, color:"#4a5568" }}>EM BREVE</div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
