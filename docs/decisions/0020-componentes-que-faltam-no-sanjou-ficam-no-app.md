# 0020 — Componentes que faltam no Sanjou ficam no app

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O vistoria precisa de componentes que o Sanjou UI não tem: os de sync (`SyncStatus`, `SyncBadge`, `ConflictResolver` e os demais da [UX de sincronização](../architecture/frontend.md#ux-de-sincronização-e-sanjou-ui)) e alguns genéricos, como navegação e Sheet. Mandar cada um para o Sanjou exigiria uma release do pacote e da biblioteca do Figma por ajuste. Os de sync ainda vão mudar muito até o M3, e só este projeto os usa.

## Decisão

Componente que falta no Sanjou é feito no app: desenhado como componente local na página "Componentes novos" do arquivo do Figma e implementado em `apps/web/src/shared/components/`, só com primitivos e tokens do Sanjou. Os específicos do vistoria ficam no app. Os genéricos são marcados "Candidato ao Sanjou" (na descrição do componente no Figma e na lista do `apps/web/CLAUDE.md`) e sobem em bloco numa release futura do Sanjou: código para o repositório do Sanjou, dele para a biblioteca do Figma, e o app troca os locais pelos do pacote.

## Consequências

Nenhuma release do Sanjou trava o MD, e os componentes de sync evoluem no ritmo do app. Os de sync recebem um `SyncState` genérico, então continuam promovíveis se outro projeto precisar. Custo aceito: nada disso é reusado por outros projetos até a promoção. A promoção também custa trabalho: mover o código e trocar instâncias e imports no app. Além disso, a regra "só primitivos e tokens do Sanjou" precisa ser vigiada na revisão para os locais não se afastarem do design system.
