# ADR-006 — Roteamento por requires_registration

**Status:** Accepted

---

## Contexto

Módulos diferentes têm comportamentos distintos de acesso: alguns exigem login e inscrição (Agenda), outros são públicos e de uso imediato (Estimator).

## Decisão

O roteamento em `[slug]/page.js` é controlado pela flag `modules.requires_registration` lida do banco — sem lógica específica por módulo no código de roteamento.

- `requires_registration = true` → verifica sessão → sem sessão ou sem inscrição → `/[slug]/register`
- `requires_registration = false` → redirect direto para `/[slug]/dashboard`

## Consequências

- Zero lógica de módulo no código de roteamento
- Novos módulos herdam o comportamento correto apenas definindo a flag no banco
