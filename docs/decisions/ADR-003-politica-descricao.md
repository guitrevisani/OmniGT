# ADR-003 — Política de Descrição de Atividades

**Status:** Accepted

---

## Contexto

A engine insere informações geradas pelos módulos na descrição das atividades do Strava. O atleta tem soberania total sobre seu conteúdo.

## Decisão

O texto original do atleta **nunca é modificado**. A engine opera exclusivamente no final da descrição, dentro de um bloco delimitado.

### Formato do bloco

```
===============================
[Nome do Evento A]
linha 1 do módulo
linha 2 do módulo

[Nome do Evento B]
linha 1 do módulo
======================= OGT ===
```

- Separação entre texto do atleta e bloco: **2 linhas em branco**
- Se a atividade não tiver descrição: bloco inserido sem espaço
- Apenas **um bloco** da engine por atividade (substituição, não acumulação)
- Retorna `null` se nenhum módulo gerou saída (sem PUT desnecessário)

### `description` nunca é campo sensível

Atualizações de descrição pelo atleta **não disparam reprocessamento**. Isso garante que:
- O atleta pode apagar o bloco permanentemente — sem reinserção automática
- A engine não entra em loop ao fazer seu próprio PUT

## Consequências

- Autonomia total do atleta preservada
- Sem risco de loop por atualização de descrição
