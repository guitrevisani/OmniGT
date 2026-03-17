/**
 * ============================================================
 * src/lib/physics/estimateFTP.js
 * ============================================================
 *
 * Estima o FTP (Functional Threshold Power) do atleta quando
 * não informado diretamente no formulário de inscrição.
 *
 * Critérios em ordem de preferência:
 *
 *   1. 110% do Z3máx de potência
 *      Fonte: zonas de potência do Strava (GET /athlete/zones)
 *      Z3máx = limite superior da zona 3 (modelo Coggan / 7 zonas)
 *
 *   2. 105% do Z3máx de FC
 *      Fonte: camp_athlete_profiles.hr_zones [z1_max, z2_max, z3_max, z4_max, hr_max]
 *      Converte FC → potência via relação linear FC/FCmáx × FTP estimado
 *      Usa a equação: FTP_est = (hr_z3_max / hr_max) × FTP_ref_epidemiológico
 *      Depois aplica: FTP = 1.05 × FTP_z3fc
 *
 *   3. Estimativa epidemiológica por gênero (massa do atleta, sem equipamento)
 *      Masculino:  3.5 W/kg
 *      Feminino:   3.0 W/kg  (ajuste epidemiológico padrão ~85% do masculino)
 *      weight_kg usado aqui é a massa do atleta — se disponível em
 *      camp_athlete_profiles.weight_kg, subtrai 10kg de equipamento;
 *      caso contrário usa 75kg como massa do atleta.
 *
 * Retorno:
 *   { ftp: number, method: 'power_zones' | 'hr_zones' | 'epidemiological' }
 *
 * ============================================================
 */

// W/kg epidemiológicos por gênero (massa do atleta, sem equipamento)
const WKG_DEFAULT = {
  masculino: 3.5,
  feminino:  3.0,
};

const EQUIPMENT_KG     = 10;   // peso estimado de equipamento
const DEFAULT_MASS_KG  = 75;   // massa do atleta se não informada

/**
 * Estima FTP a partir de zonas de potência do Strava.
 * powerZones: array de 7 objetos { min, max } em watts (modelo Coggan)
 * Z3 = índice 2 (base 0)
 *
 * @param {Array} powerZones
 * @returns {number|null}
 */
function ftpFromPowerZones(powerZones) {
  if (!Array.isArray(powerZones) || powerZones.length < 3) return null;
  const z3Max = powerZones[2]?.max;
  if (!z3Max || z3Max <= 0) return null;
  return Math.round(z3Max * 1.10);
}

/**
 * Estima FTP a partir das zonas de FC do atleta.
 * hrZones: [z1_max, z2_max, z3_max, z4_max, hr_max] em bpm
 *
 * Método: FTP_fc = (hr_z3_max / hr_max) × FTP_epidemiológico
 *         FTP    = 1.05 × FTP_fc
 *
 * @param {number[]} hrZones
 * @param {string}   gender   'masculino' | 'feminino'
 * @param {number}   weightKg massa do atleta (sem equipamento)
 * @returns {number|null}
 */
function ftpFromHrZones(hrZones, gender, weightKg) {
  if (!Array.isArray(hrZones) || hrZones.length < 5) return null;

  const hrZ3Max = hrZones[2];
  const hrMax   = hrZones[4];

  if (!hrZ3Max || !hrMax || hrMax <= 0) return null;

  const wkg         = WKG_DEFAULT[gender] ?? WKG_DEFAULT.masculino;
  const ftpEpidemic = wkg * weightKg;
  const ftpFc       = (hrZ3Max / hrMax) * ftpEpidemic;

  return Math.round(ftpFc * 1.05);
}

/**
 * Estima FTP por epidemiologia (gênero + massa do atleta).
 *
 * @param {string} gender   'masculino' | 'feminino'
 * @param {number} weightKg massa do atleta (sem equipamento)
 * @returns {number}
 */
function ftpFromEpidemiological(gender, weightKg) {
  const wkg = WKG_DEFAULT[gender] ?? WKG_DEFAULT.masculino;
  return Math.round(wkg * weightKg);
}

/**
 * Resolve o FTP do atleta seguindo a ordem de preferência.
 *
 * @param {object} options
 * @param {number|null}   options.ftpW         FTP informado no formulário (prioridade máxima)
 * @param {Array|null}    options.powerZones    Zonas de potência do Strava (7 zonas Coggan)
 * @param {number[]|null} options.hrZones       [z1_max, z2_max, z3_max, z4_max, hr_max]
 * @param {string}        options.gender        'masculino' | 'feminino'
 * @param {number|null}   options.weightKg      Massa total informada no formulário (atleta + equipamento)
 *
 * @returns {{ ftp: number, method: string }}
 */
export function estimateFTP({ ftpW, powerZones, hrZones, gender, weightKg }) {
  // FTP informado diretamente — máxima prioridade, sem estimativa
  if (ftpW && ftpW > 0) {
    return { ftp: Math.round(ftpW), method: 'informed' };
  }

  // Massa do atleta: remove equipamento se peso total informado
  const athleteMassKg = weightKg
    ? Math.max(40, weightKg - EQUIPMENT_KG)
    : DEFAULT_MASS_KG;

  const genderKey = gender === 'feminino' ? 'feminino' : 'masculino';

  // 1. Zonas de potência do Strava
  const fromPower = ftpFromPowerZones(powerZones);
  if (fromPower) {
    return { ftp: fromPower, method: 'power_zones' };
  }

  // 2. Zonas de FC do atleta
  // TODO: método suspenso — a conversão FC/FCmáx → potência requer
  // calibração com dados reais de potência associados às zonas de FC.
  // Sem essa âncora, o resultado pode ser pior que o epidemiológico.
  // Manter ftpFromHrZones() implementada para uso futuro.
  //
  // const fromHr = ftpFromHrZones(hrZones, genderKey, athleteMassKg);
  // if (fromHr) {
  //   return { ftp: fromHr, method: 'hr_zones' };
  // }

  // 3. Epidemiológico
  return {
    ftp:    ftpFromEpidemiological(genderKey, athleteMassKg),
    method: 'epidemiological',
  };
}
