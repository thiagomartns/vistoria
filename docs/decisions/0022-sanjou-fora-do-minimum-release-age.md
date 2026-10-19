# 0022 — Sanjou fora do minimumReleaseAge

- **Status:** Aceito
- **Data:** 2026-10-19

## Contexto

O [Supply chain](../architecture/frontend.md#segurança) do front exige `minimumReleaseAge` de 7 dias no pnpm: versão publicada há menos tempo não instala. A regra protege contra pacote de terceiro comprometido, que costuma ser descoberto e despublicado nos primeiros dias. O Sanjou UI é do mesmo dono deste repositório, e o app precisa da versão nova assim que ela sai: a biblioteca do Figma usada no design é validada contra ela. Na issue #11, `@sanjou/ui` e `@sanjou/tokens` 0.2.0 tinham 3 dias e o pnpm recusava instalar.

## Decisão

O escopo `@sanjou/*` fica fora do `minimumReleaseAge` (`minimumReleaseAgeExclude` no `pnpm-workspace.yaml`). As dependências transitivas do Sanjou (Radix, lucide etc.) continuam com os 7 dias.

## Consequências

Uma release do Sanjou entra no app no mesmo dia, sem esperar uma semana nem relaxar a regra para o resto. Custo aceito: a proteção desse escopo passa a depender só da publicação do Sanjou (trusted publishing com provenance, sem token de longa duração); uma conta npm ou um workflow comprometido no repositório do Sanjou chega ao app sem a janela de 7 dias. A versão continua fixada e o lockfile, commitado, então nada sobe sem um PR aqui.
