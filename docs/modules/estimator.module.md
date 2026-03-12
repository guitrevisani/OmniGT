# Módulo: Estimator

**Localização:** `src/app/[slug]/dashboard/EstimatorDashboard.jsx`
**Slug:** `estimator`
**ID no banco:** `3`
**requires_registration:** `false`
**REPROCESS_ON_DELETE:** `false`

---

## Objetivo

Estimar o tempo de percurso de um roteiro de ciclismo a partir de um arquivo GPX,
usando modelo físico de resistência aerodinâmica e rolling resistance.

---

## Acesso

Público — não requer login. O atleta pode usar sem se inscrever.
Se autenticado, carrega configurações personalizadas do evento via `/api/estimator/[slug]`.

---

## Modelo Físico

### Constantes fixas (não configuráveis)

| Constante | Valor | Descrição |
|---|---|---|
| `RHO` | 1.2 | Densidade do ar (kg/m³) |
| `G` | 9.81 | Gravidade (m/s²) |
| `ETA` | 0.97 | Eficiência da transmissão |
| `K_ROLL` | 0.5 | Fator de momentum em terreno rolling |
| `GRADE_UP` | 0.03 | Limiar de subida (3%) |
| `GRADE_DN` | -0.03 | Limiar de descida (-3%) |

### Parâmetros configuráveis por evento (em `event_configs.metadata`)

| Parâmetro | Padrão | Editável |
|---|---|---|
| `mass_kg` | 85 | ✅ (ciclista + equipamento) |
| `default_ftp_w` | 260 | ✅ (no WkgControl) |
| `descent_kmh` | 45 | ✅ |
| `cda` | 0.32 | ❌ (futuro) |
| `crr` | 0.004 | ❌ (futuro) |

### Calibração

Modelo calibrado com K_ROLL = 0.5:
- Benchmark Pofexô (86.8km +875m) a 2.0 w/kg → 170min (GPS real: 169min, erro 0.6%)
- Rodosudoeste (119.7km +2437m) a 2.5 w/kg → 240min ✓

---

## Zonas de Intensidade (IF)

| IF | Zona | Cor |
|---|---|---|
| ≤ 0.6 | REGENERATIVO | `#4db6ac` |
| ≤ 0.75 | ENDURANCE | `#8bc34a` |
| ≤ 0.95 | FORTE/LIMIAR | `#ffc107` |
| ≤ 1.05 | MÁXIMO | `#ff1744` |
| > 1.05 | HIIT | `#7e0b22` |

---

## Categorização de Subidas (critério Strava)

Score = comprimento (m) × inclinação média (%)
Requisito mínimo: grade ≥ 3% e comprimento ≥ 500m

| Score | Categoria |
|---|---|
| ≥ 80.000 | HC |
| ≥ 64.000 | Cat 1 |
| ≥ 32.000 | Cat 2 |
| ≥ 16.000 | Cat 3 |
| ≥ 8.000 | Cat 4 |

---

## Exportação de Imagem

Botão "📷 COMPARTILHAR" gera PNG via canvas (1080px) com:
- Nome da rota
- Zona de intensidade + w/kg + FTP + massa
- Cards de tempo em movimento e tempo total
- Perfil altimétrico colorido por gradiente
- Lista de subidas categorizadas
- Footer: `OGT · OMNI GT`

---

## API

`GET /api/estimator/[slug]` — público, retorna configs do evento mescladas com defaults:

```json
{
  "config": {
    "mass_kg": 85,
    "default_ftp_w": 260,
    "descent_kmh": 45,
    "cda": 0.32,
    "crr": 0.004
  }
}
```

---

## Notas

- Sem persistência — uso imediato, sem salvar resultados
- Integração meteorológica (windMps) prevista mas não implementada
- FTP editável apenas no WkgControl — não aparece nos Parâmetros do Sistema
