"use client";

import { useState, useEffect, useMemo } from "react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtKm(m)         { return (m / 1000).toFixed(1); }
function fmtHr(sec)       { const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60); return `${h}:${String(m).padStart(2,"0")}`; }

function getMonday(date) {
  const d = new Date(date), day = d.getDay(), diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff); d.setHours(0,0,0,0); return d;
}
function isoToDate(str)  { const [y,m,d] = str.split("-").map(Number); return new Date(y,m-1,d); }
function dateToIso(d)    { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function computeMetrics(daily, goals, eventStartDate) {
  if (!daily || daily.length === 0) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const activeDays = daily.filter(d => d.is_active);
  if (activeDays.length === 0) return null;
  const byDate = {};
  daily.forEach(d => { byDate[d.date] = d; });

  const lastActive      = activeDays[activeDays.length - 1];
  const totalDistanceM  = daily.reduce((s,d) => s+d.distance_m, 0);
  const totalMovingSec  = daily.reduce((s,d) => s+d.moving_sec, 0);
  const totalElevationM = daily.reduce((s,d) => s+d.elevation_m, 0);
  const totalActiveDays = activeDays.length;

  let streak = 0, streakKm = 0;
  let cursor = new Date(isoToDate(lastActive.date));
  while (true) {
    const iso = dateToIso(cursor), day = byDate[iso];
    if (day && day.is_active) { streak++; streakKm += day.distance_m; cursor.setDate(cursor.getDate()-1); }
    else break;
  }

  const monday = getMonday(today), sunday = new Date(monday); sunday.setDate(sunday.getDate()+6);
  const weekDays      = daily.filter(d => { const dt = isoToDate(d.date); return dt >= monday && dt <= sunday; });
  const weekKm        = weekDays.reduce((s,d) => s+d.distance_m, 0);
  const weekSec       = weekDays.reduce((s,d) => s+d.moving_sec, 0);
  const weekElevation = weekDays.reduce((s,d) => s+d.elevation_m, 0);

  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate()-6);
  const rolling7Km   = daily.filter(d => { const dt=isoToDate(d.date); return dt>=sevenDaysAgo&&dt<=today; }).reduce((s,d)=>s+d.distance_m,0);

  const monthDays      = daily.filter(d => { const dt=isoToDate(d.date); return dt.getFullYear()===today.getFullYear()&&dt.getMonth()===today.getMonth(); });
  const monthKm        = monthDays.reduce((s,d)=>s+d.distance_m,0);
  const monthSec       = monthDays.reduce((s,d)=>s+d.moving_sec,0);
  const monthElevation = monthDays.reduce((s,d)=>s+d.elevation_m,0);

  const yearDays      = daily.filter(d => isoToDate(d.date).getFullYear()===today.getFullYear());
  const yearKm        = yearDays.reduce((s,d)=>s+d.distance_m,0);
  const yearSec       = yearDays.reduce((s,d)=>s+d.moving_sec,0);
  const yearElevation = yearDays.reduce((s,d)=>s+d.elevation_m,0);

  const maxDistDay = activeDays.reduce((a,b) => b.distance_m>a.distance_m?b:a);
  const minDistDay = activeDays.reduce((a,b) => b.distance_m<a.distance_m?b:a);
  const maxTimeDay = activeDays.reduce((a,b) => b.moving_sec>a.moving_sec?b:a);
  const minTimeDay = activeDays.reduce((a,b) => b.moving_sec<a.moving_sec?b:a);

  const buckets = {"<25":0,"25–50":0,"50–75":0,"75–100":0,"100–125":0,"125–150":0,"150–175":0,"175–200":0,"≥200":0};
  activeDays.forEach(d => {
    const km = d.distance_m/1000;
    if      (km<25)  buckets["<25"]++;
    else if (km<50)  buckets["25–50"]++;
    else if (km<75)  buckets["50–75"]++;
    else if (km<100) buckets["75–100"]++;
    else if (km<125) buckets["100–125"]++;
    else if (km<150) buckets["125–150"]++;
    else if (km<175) buckets["150–175"]++;
    else if (km<200) buckets["175–200"]++;
    else             buckets["≥200"]++;
  });

  const eventStart = isoToDate(eventStartDate);
  const dayOfYear  = Math.floor((today - eventStart)/86400000)+1;
  const goalKm     = goals.distance_km;
  const avgPerDay  = goalKm/365;
  const expectedKm = avgPerDay*dayOfYear;
  const actualKm   = totalDistanceM/1000;
  const diffKm     = actualKm-expectedKm;
  const diffDays   = diffKm/avgPerDay;

  const weeklyMap = {};
  daily.forEach(d => {
    const mon = dateToIso(getMonday(isoToDate(d.date)));
    if (!weeklyMap[mon]) weeklyMap[mon] = {km:0,sec:0,elev:0};
    weeklyMap[mon].km   += d.distance_m/1000;
    weeklyMap[mon].sec  += d.moving_sec;
    weeklyMap[mon].elev += d.elevation_m;
  });
  const weeklyData = Object.entries(weeklyMap).sort(([a],[b])=>a.localeCompare(b)).map(([week,v])=>({week,...v}));

  const monthlyMap = {};
  daily.forEach(d => {
    const key = d.date.slice(0,7);
    if (!monthlyMap[key]) monthlyMap[key] = {km:0,sec:0,elev:0};
    monthlyMap[key].km   += d.distance_m/1000;
    monthlyMap[key].sec  += d.moving_sec;
    monthlyMap[key].elev += d.elevation_m;
  });
  const monthlyData = Object.entries(monthlyMap).sort(([a],[b])=>a.localeCompare(b)).map(([month,v])=>({month,...v}));

  return { lastActiveDate:lastActive.date, lastActiveKm:lastActive.distance_m, lastActiveSec:lastActive.moving_sec,
    totalDistanceM, totalMovingSec, totalElevationM, totalActiveDays, streak, streakKm,
    weekKm, weekSec, weekElevation, rolling7Km, monthKm, monthSec, monthElevation,
    yearKm, yearSec, yearElevation, maxDistDay, minDistDay, maxTimeDay, minTimeDay,
    buckets, goalKm, expectedKm, actualKm, diffKm, diffDays, avgPerDay, dayOfYear,
    weeklyData, monthlyData, daily };
}

function BarChart({ data, valueKey, labelKey, color="#f97316", height=80 }) {
  const max = Math.max(...data.map(d=>d[valueKey]),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:2,height,width:"100%"}}>
      {data.map((d,i) => (
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
          <div title={`${d[labelKey]}: ${d[valueKey].toFixed(1)}`}
            style={{width:"100%",height:`${Math.max((d[valueKey]/max)*(height-16),2)}px`,
              background:color,borderRadius:"2px 2px 0 0",transition:"height 0.3s ease"}} />
        </div>
      ))}
    </div>
  );
}

function ActivityHeatmap({ daily, startDate }) {
  const byDate={};
  daily.forEach(d=>{byDate[d.date]=d.distance_m;});
  const today=new Date(); today.setHours(0,0,0,0);
  const maxKm=Math.max(...daily.map(d=>d.distance_m/1000),1);
  const weeks=[];
  let cursor=getMonday(isoToDate(startDate));
  while (cursor<=today) {
    const week=[];
    for (let i=0;i<7;i++) {
      const iso=dateToIso(cursor), km=(byDate[iso]||0)/1000;
      week.push({iso,km,future:cursor>today});
      cursor=new Date(cursor); cursor.setDate(cursor.getDate()+1);
    }
    weeks.push(week);
  }
  function cellColor(km,future) {
    if (future) return "transparent";
    if (km===0) return "#1a1a2e";
    const t=Math.min(km/maxKm,1);
    return `rgb(${Math.round(45+(249-45)*t)},${Math.round(26+(115-26)*t)},${Math.round(0+(22-0)*t)})`;
  }
  const dayLabels=["S","T","Q","Q","S","S","D"];
  return (
    <div style={{overflowX:"auto",paddingBottom:4}}>
      <div style={{display:"flex",gap:2}}>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {dayLabels.map((l,i)=><div key={i} style={{height:11,width:14,fontSize:8,color:"#555",display:"flex",alignItems:"center"}}>{l}</div>)}
        </div>
        {weeks.map((week,wi)=>(
          <div key={wi} style={{display:"flex",flexDirection:"column",gap:2}}>
            {week.map((day,di)=>(
              <div key={di} title={day.future?"":` ${day.iso}: ${day.km.toFixed(1)} km`}
                style={{width:11,height:11,borderRadius:2,background:cellColor(day.km,day.future),
                  border:day.future?"none":"1px solid rgba(255,255,255,0.04)"}} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({label,value,sub,accent=false}) {
  return (
    <div style={{background:accent?"rgba(249,115,22,0.12)":"rgba(255,255,255,0.04)",
      border:`1px solid ${accent?"rgba(249,115,22,0.4)":"rgba(255,255,255,0.08)"}`,
      borderRadius:10,padding:"14px 16px"}}>
      <div style={{fontSize:11,color:"#888",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,fontFamily:"'DM Mono',monospace"}}>{label}</div>
      <div style={{fontSize:accent?28:22,fontWeight:700,color:accent?"#f97316":"#f0f0f0",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.02em",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:"#666",marginTop:4,fontFamily:"'DM Mono',monospace"}}>{sub}</div>}
    </div>
  );
}

function SectionTitle({children}) {
  return (
    <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:"#f97316",textTransform:"uppercase",
      letterSpacing:"0.15em",marginBottom:12,marginTop:4,display:"flex",alignItems:"center",gap:8}}>
      <div style={{flex:1,height:1,background:"rgba(249,115,22,0.3)"}} />
      {children}
      <div style={{flex:1,height:1,background:"rgba(249,115,22,0.3)"}} />
    </div>
  );
}

// ─── Botão de sincronização manual ──────────────────────────────────────────

function SyncButton({ slug, onSuccess }) {
  const [status, setStatus] = useState("idle"); // idle | loading | ok | error

  async function handleSync() {
    setStatus("loading");
    try {
      const res = await fetch("/api/agenda/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error("sync_failed");
      setStatus("ok");
      setTimeout(() => { setStatus("idle"); onSuccess(); }, 1500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }

  const label = status === "loading" ? "sincronizando…"
              : status === "ok"      ? "✓ atualizado"
              : status === "error"   ? "erro — tente novamente"
              : "↺ sincronizar";

  const bg = status === "ok"    ? "rgba(74,222,128,0.15)"
           : status === "error" ? "rgba(248,113,113,0.15)"
           : "rgba(255,255,255,0.06)";

  const borderColor = status === "ok"    ? "rgba(74,222,128,0.4)"
                    : status === "error" ? "rgba(248,113,113,0.4)"
                    : "rgba(255,255,255,0.12)";

  const color = status === "ok"    ? "#4ade80"
              : status === "error" ? "#f87171"
              : "#888";

  return (
    <button
      onClick={handleSync}
      disabled={status === "loading"}
      style={{
        background:   bg,
        border:       `1px solid ${borderColor}`,
        borderRadius: 6,
        color,
        fontFamily:   "'DM Mono', monospace",
        fontSize:     11,
        letterSpacing:"0.08em",
        padding:      "6px 12px",
        cursor:       status === "loading" ? "default" : "pointer",
        transition:   "all 0.2s ease",
      }}
    >
      {label}
    </button>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function AgendaDashboard({ slug }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  function loadData() {
    setLoading(true);
    fetch(`/api/agenda/${slug}`)
      .then(r => { if (r.status===401) throw new Error("not_authenticated"); if (!r.ok) throw new Error("fetch_failed"); return r.json(); })
      .then(d  => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }

  useEffect(() => { loadData(); }, [slug]);

  const metrics = useMemo(() => data ? computeMetrics(data.daily, data.goals, data.event.start_date) : null, [data]);

  if (loading) return <div style={S.center}><div style={S.spinner}/></div>;
  if (error==="not_authenticated") return <div style={S.center}><p style={S.mono}>Sessão expirada.</p><a href={`/api/auth/strava/start?event=${slug}`} style={S.btn}>Entrar com Strava</a></div>;
  if (error||!data||!metrics) return <div style={S.center}><p style={S.mono}>Erro ao carregar dados.</p></div>;

  const { goals } = data;
  const m = metrics;
  const goalPct   = goals.distance_km>0 ? Math.min((m.totalDistanceM/1000/goals.distance_km)*100,100) : 0;
  const maxBucket = Math.max(...Object.values(m.buckets),1);

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#0d0d14}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#333;border-radius:2px}`}</style>
      <div style={S.page}>

        <header style={S.header}>
          <div>
            <div style={{fontSize:11,color:"#f97316",fontFamily:"'DM Mono',monospace",letterSpacing:"0.15em",textTransform:"uppercase"}}>Agenda de Treinos</div>
            <h1 style={{fontSize:28,fontFamily:"'Bebas Neue',sans-serif",color:"#f0f0f0",letterSpacing:"0.05em",lineHeight:1.1}}>{data.event.name}</h1>
            <div style={{fontSize:11,color:"#555",fontFamily:"'DM Mono',monospace",marginTop:2}}>{data.event.start_date} → {data.event.end_date} · dia {m.dayOfYear} do ano</div>
          </div>
          <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
            <div>
              <div style={{fontSize:11,color:"#555",fontFamily:"'DM Mono',monospace"}}>meta anual</div>
              <div style={{fontSize:22,fontFamily:"'Bebas Neue',sans-serif",color:"#f0f0f0"}}>{goals.distance_km.toLocaleString("pt-BR")} km</div>
              <div style={{fontSize:11,color:"#555",fontFamily:"'DM Mono',monospace"}}>{fmtHr(goals.moving_time_sec)} hrs</div>
            </div>
            <SyncButton slug={slug} onSuccess={loadData} />
          </div>
        </header>

        <div style={{marginBottom:28}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={S.mono11}>{m.actualKm.toFixed(0)} km realizados</span>
            <span style={S.mono11}>{goalPct.toFixed(1)}% da meta</span>
          </div>
          <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:4,position:"relative"}}>
            <div style={{height:"100%",width:`${goalPct}%`,background:"linear-gradient(90deg,#ea580c,#f97316,#fb923c)",borderRadius:4,transition:"width 1s ease"}} />
            <div style={{position:"absolute",left:`${Math.min((m.expectedKm/goals.distance_km)*100,100)}%`,top:-4,bottom:-4,width:2,background:"#ffffff44",borderRadius:1}} />
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
            <span style={{...S.mono11,color:m.diffKm>=0?"#4ade80":"#f87171"}}>{m.diffKm>=0?"+":""}{m.diffKm.toFixed(0)} km vs pace ({m.diffDays>=0?"+":""}{m.diffDays.toFixed(1)} dias)</span>
            <span style={S.mono11}>esperado: {m.expectedKm.toFixed(0)} km</span>
          </div>
        </div>

        <SectionTitle>Calendário</SectionTitle>
        <div style={S.card}><ActivityHeatmap daily={m.daily} startDate={data.event.start_date} /></div>

        <SectionTitle>Destaques</SectionTitle>
        <div style={S.grid4}>
          <StatCard accent label="Último dia ativo" value={`${fmtKm(m.lastActiveKm)} km`} sub={`${m.lastActiveDate} · ${fmtHr(m.lastActiveSec)}`} />
          <StatCard accent label="Sequência atual" value={`${m.streak} dias`} sub={`${fmtKm(m.streakKm)} km na sequência`} />
          <StatCard label="Dias ativos" value={m.totalActiveDays} sub="≥ 15 min em movimento" />
          <StatCard label="Total acumulado" value={`${(m.totalDistanceM/1000).toFixed(0)} km`} sub={`${fmtHr(m.totalMovingSec)} · ${(m.totalElevationM/1000).toFixed(1)}k m↑`} />
        </div>

        <SectionTitle>Esta Semana (seg–dom)</SectionTitle>
        <div style={S.grid3}>
          <StatCard label="Distância" value={`${fmtKm(m.weekKm)} km`} />
          <StatCard label="Tempo" value={fmtHr(m.weekSec)} />
          <StatCard label="Elevação" value={`${(m.weekElevation/1000).toFixed(2)}k m`} />
        </div>
        <div style={{marginTop:8,marginBottom:16}}><span style={S.mono11}>7 dias corridos: <span style={{color:"#f0f0f0"}}>{fmtKm(m.rolling7Km)} km</span></span></div>

        <SectionTitle>Este Mês</SectionTitle>
        <div style={S.grid3}>
          <StatCard label="Distância" value={`${fmtKm(m.monthKm)} km`} />
          <StatCard label="Tempo" value={fmtHr(m.monthSec)} />
          <StatCard label="Elevação" value={`${(m.monthElevation/1000).toFixed(2)}k m`} />
        </div>

        <SectionTitle>Este Ano</SectionTitle>
        <div style={S.grid3}>
          <StatCard label="Distância" value={`${(m.yearKm/1000).toFixed(1)}k km`} />
          <StatCard label="Tempo" value={fmtHr(m.yearSec)} />
          <StatCard label="Elevação" value={`${(m.yearElevation/1000).toFixed(1)}k m`} />
        </div>

        <SectionTitle>Recordes</SectionTitle>
        <div style={S.grid4}>
          <StatCard label="Maior distância" value={`${fmtKm(m.maxDistDay.distance_m)} km`} sub={m.maxDistDay.date} />
          <StatCard label="Maior tempo" value={fmtHr(m.maxTimeDay.moving_sec)} sub={m.maxTimeDay.date} />
          <StatCard label="Menor distância" value={`${fmtKm(m.minDistDay.distance_m)} km`} sub={m.minDistDay.date} />
          <StatCard label="Menor tempo" value={fmtHr(m.minTimeDay.moving_sec)} sub={m.minTimeDay.date} />
        </div>

        <SectionTitle>Distribuição por Distância (dias ativos)</SectionTitle>
        <div style={S.card}>
          {Object.entries(m.buckets).map(([label,count])=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <div style={{width:60,fontSize:11,fontFamily:"'DM Mono',monospace",color:"#888",textAlign:"right"}}>{label} km</div>
              <div style={{flex:1,height:20,background:"rgba(255,255,255,0.04)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${(count/maxBucket)*100}%`,background:count>0?"#f97316":"transparent",borderRadius:3,transition:"width 0.6s ease"}} />
              </div>
              <div style={{width:28,fontSize:11,fontFamily:"'DM Mono',monospace",color:count>0?"#f0f0f0":"#444"}}>{count}</div>
            </div>
          ))}
        </div>

        <SectionTitle>Km por Semana</SectionTitle>
        <div style={S.card}>
          <BarChart data={m.weeklyData} valueKey="km" labelKey="week" color="#f97316" height={100} />
          <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
            <span style={S.mono11}>{m.weeklyData[0]?.week}</span>
            <span style={S.mono11}>{m.weeklyData[m.weeklyData.length-1]?.week}</span>
          </div>
        </div>

        <SectionTitle>Km por Mês</SectionTitle>
        <div style={S.card}>
          <BarChart data={m.monthlyData} valueKey="km" labelKey="month" color="#fb923c" height={100} />
          <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
            {m.monthlyData.map((d,i)=><span key={i} style={{...S.mono11,flex:1,textAlign:"center"}}>{d.month.slice(5)}</span>)}
          </div>
        </div>

        <SectionTitle>Elevação por Mês (m)</SectionTitle>
        <div style={S.card}><BarChart data={m.monthlyData} valueKey="elev" labelKey="month" color="#a78bfa" height={80} /></div>

        <footer style={S.footer}>
          <span>OGT Event Engine</span>
          <span>atualizado via Strava API</span>
        </footer>
      </div>
    </>
  );
}

const S = {
  page:    { minHeight:"100vh", background:"#0d0d14", color:"#f0f0f0", fontFamily:"'DM Sans',sans-serif", maxWidth:780, margin:"0 auto", padding:"24px 16px 48px" },
  header:  { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24, paddingBottom:20, borderBottom:"1px solid rgba(255,255,255,0.06)" },
  card:    { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"16px", marginBottom:16 },
  grid4:   { display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:16 },
  grid3:   { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 },
  mono11:  { fontSize:11, fontFamily:"'DM Mono',monospace", color:"#555" },
  center:  { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", gap:16, background:"#0d0d14" },
  spinner: { width:32, height:32, border:"3px solid rgba(249,115,22,0.2)", borderTop:"3px solid #f97316", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  btn:     { padding:"10px 20px", background:"#f97316", color:"#fff", borderRadius:6, textDecoration:"none", fontFamily:"'DM Mono',monospace", fontSize:13 },
  footer:  { marginTop:48, paddingTop:16, borderTop:"1px solid rgba(255,255,255,0.05)", display:"flex", justifyContent:"space-between", fontSize:11, fontFamily:"'DM Mono',monospace", color:"#333" },
  mono:    { color:"#888", fontFamily:"'DM Mono',monospace", fontSize:13 },
};
