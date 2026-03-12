# ADR-007 — Separação Worker/Dispatcher

**Status:** Accepted

---

## Contexto

O worker precisa coletar dados brutos do Strava e disparar processamento por módulo. A lógica de cada módulo é independente e não deve estar acoplada ao worker.

## Decisão

**Worker = coletor.** Responsabilidades exclusivas:
- Buscar dados brutos no Strava
- UPSERT em `activities`
- Detectar duplicatas
- Registrar gear
- Popular `event_activities`
- Disparar dispatcher

**Dispatcher = processador.** Responsabilidades exclusivas:
- Ler `event_activities` pendentes
- Executar lógica de cada módulo (consolidate + build)
- mergeDescription + PUT Strava
- Atualizar loop guard

O worker não importa nenhum módulo. O dispatcher registra módulos em `MODULE_REGISTRY` — adicionar um novo módulo requer apenas uma nova entrada nesse objeto.

## Consequências

- Worker estável: não precisa ser alterado quando novos módulos são criados
- Módulos podem ser testados isoladamente sem depender do worker
- Pipeline claro e auditável em dois estágios
