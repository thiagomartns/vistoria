# 0033 — Movimento, carregamento e avisos na UI

- **Status:** Proposto
- **Data:** 2026-10-22

## Contexto

Com as telas de clientes (#73), a UI ficou "chapada". A troca de tela e a entrada de itens não têm transição, e enquanto o banco local abre a tela fica em branco. Também falta um componente para avisos passageiros: no #72, o Toast das notas do Figma virou `Alert` porque o Sonner não estava no [mapa Figma → Sanjou](../architecture/figma-sanjou.md). Várias reações da [tabela de erros](../architecture/frontend.md#reação-aos-erros) pedem um aviso ("Aceitar o servidor", "Descartar e avisar"), e a atualização do PWA também ("Nova versão disponível"). Surgiu a ideia de usar TanStack Query para controlar o carregamento. A única regra de movimento hoje é a diretriz da [UX de sincronização](../architecture/frontend.md#ux-de-sincronização-e-sanjou-ui): animação só em transição de estado, curta e desligada por `prefers-reduced-motion`.

## Decisão

- **Movimento:** o conjunto de transições (troca de tela, entrada de item na lista, painel, aviso) é desenhado no Figma antes de qualquer código, numa issue de design, e segue aquela diretriz. Nenhuma tela ganha animação improvisada.
- **Carregamento:** enquanto o banco local abre, as listas mostram o `Skeleton` do Sanjou em vez de nada. O progresso do envio continua só no `SyncStatus`, no `SyncBadge` e no `OutboxPanel`.
- **Avisos:** o toast é o `Toaster` do Sanjou (`@sanjou/ui/sonner`), montado no shell. Ele dá os avisos passageiros das reações e da versão nova. Erro de formulário continua no `Alert`.
- **TanStack Query:** fica fora. A UI lê só o banco local ([ADR 0016](0016-local-first-tanstack-db-outbox.md)), e o Query continua sendo o plano B, nunca uma camada ao lado do TanStack DB ([ADR 0030](0030-tanstack-db-mantido-apos-o-spike-1a-outbox-persistida-contra-o-upsertclient.md)).
- **Notificação do sistema (push):** fica fora da V1.

## Consequências

A tela deixa de ficar em branco, e os avisos ganham um componente só, do Sanjou, em vez de um `Alert` por tela. O movimento passa a ter uma fonte, como o resto do visual. Custos aceitos:
- As telas do M2 seguem sem transição até o design de movimento existir.
- O app ganha `sonner` como dependência direta, porque o `toast()` vem dele, e o mapa Figma → Sanjou muda.
- O `Skeleton` pode piscar por milissegundos num aparelho rápido.
- Sem push, um conflito ou uma recusa só aparece quando o vistoriador abre o app.
