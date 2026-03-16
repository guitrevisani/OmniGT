# ADR-010 — accepted_sport_types configuráveis por evento

**Status:** Accepted

---

## Contexto

O módulo Agenda define `ACCEPTED_SPORT_TYPES` como constante hardcoded em
`src/engine/modules/agenda/index.js`. O dispatcher lê essa constante diretamente
do módulo no `MODULE_REGISTRY`.

O módulo Camp exige `accepted_sport_types` configurável por evento — um camp de
ciclismo aceita tipos diferentes de um camp de corrida, e isso é definido pelo
owner na criação do evento via `event_configs.metadata.accepted_sport_types`.

Manter `accepted_sport_types` hardcoded por módulo impede essa flexibilidade e
cria dois contratos diferentes (um por módulo, outro por evento) para a mesma
informação.

## Decisão

`accepted_sport_types` passa a ser lido de `event_configs.metadata.accepted_sport_types`
para todos os módulos. O dispatcher busca esse valor do banco por evento antes de
processar cada atividade.

O `MODULE_REGISTRY` deixa de expor `acceptedSportTypes` como campo estático.
A filtragem por sport_type passa a ocorrer no dispatcher com o valor do banco,
não com o valor do módulo.

Módulos que precisam de um fallback (ex: Agenda) devem ter seus `accepted_sport_types`
inseridos em `event_configs.metadata` no banco antes do deploy desta alteração.

## Consequências

- Agenda: sem mudança de comportamento — desde que `event_configs.metadata.accepted_sport_types`
  esteja preenchido para o evento 1 antes do deploy
- Camp: `accepted_sport_types` definido pelo owner na criação do evento, sem hardcode
- Novos módulos: não precisam mais definir `ACCEPTED_SPORT_TYPES` em `index.js`
- Dispatcher: uma query adicional por atividade para buscar `event_configs.metadata`
  (já buscado para outros fins — pode ser incorporado à query existente)
- Risco: se `event_configs.metadata.accepted_sport_types` estiver ausente para um
  evento, o dispatcher rejeita todas as atividades desse evento — ausência não tem
  fallback permissivo
