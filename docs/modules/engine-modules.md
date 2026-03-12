# Engine — Módulos

## Visão Geral

Módulos são unidades independentes de lógica executadas pelo dispatcher para cada evento associado ao atleta. Cada módulo recebe um contexto padronizado e retorna outputs estruturados.

**Regras dos módulos:**
- Podem calcular métricas derivadas de atividades
- Podem gerar fragmentos de texto para a descrição
- **Não chamam a API do Strava**
- **Não fazem PUT em atividades**
- **Não dependem de outros módulos**

---

## Módulos Registrados

| Módulo | Slug | ID | requires_registration | REPROCESS_ON_DELETE |
|---|---|---|---|---|
| Agenda de Treinos | `agenda` | 1 | true | true |
| Estimator | `estimator` | 3 | false | false |

---

## Contrato do index.js

Cada módulo exporta constantes lidas pelo dispatcher e pelo worker:

```javascript
// Tipos de atividade aceitos — worker filtra antes de processar
export const ACCEPTED_SPORT_TYPES = ["Ride", "VirtualRide", ...];

// Se true, atividades deletadas disparam reprocessamento em cascata
// Configurado pelo provider no desenvolvimento do módulo, não pelo owner
export const REPROCESS_ON_DELETE = true;

// Se true, o dispatcher não gera bloco de descrição
export const isRegistration = false;
```

---

## Registro no Dispatcher

Módulos são registrados em `MODULE_REGISTRY` em `src/app/api/internal/module-dispatcher/route.js`:

```javascript
const MODULE_REGISTRY = {
  agenda: {
    acceptedSportTypes: ACCEPTED_SPORT_TYPES,
    consolidate: async (context) => { /* busca dados do banco */ },
    build: (data, context) => { /* retorna descriptionBlock */ },
  },
  // novo módulo: apenas adicionar entrada aqui
};
```

O dispatcher não precisa ser alterado para outros aspectos — apenas `MODULE_REGISTRY`.

---

## moduleRunner

Executor genérico que orquestra os builders:

```javascript
runModule({ moduleName, context, consolidate, builders })
```

Fluxo:
1. `consolidate(context)` → busca dados do banco
2. `computeTotals(data)` → calcula totais
3. `computeDashboard(data)` → agrega dados para dashboard
4. `buildDescription({ ...data, totals, context })` → monta bloco de texto

---

## mergeDescription

Coleta os `descriptionBlock` de todos os módulos e monta a descrição final:

```
[texto original do atleta]


===============================
[Nome do Evento A]
bloco do módulo A

[Nome do Evento B]
bloco do módulo B
======================= OGT ===
```

Retorna `null` se nenhum módulo gerou saída (sem PUT desnecessário).

Funções exportadas:
- `mergeDescription(originalDescription, moduleOutputs[])` → `string | null`
- `hasEngineBlock(description)` → `boolean`
- `removeEngineBlock(description)` → `string`

---

## Adicionando um Novo Módulo

1. Criar `src/engine/modules/<slug>/index.js` com as constantes exportadas
2. Implementar builders: `buildDescription.js`, `computeTotals.js` (se aplicável)
3. Registrar no banco: `INSERT INTO modules (name, slug, requires_registration, is_active)`
4. Adicionar entrada em `MODULE_REGISTRY` no dispatcher
5. Criar evento: `INSERT INTO events (..., module_id)`
6. Adicionar documentação em `docs/modules/<slug>.module.md`
