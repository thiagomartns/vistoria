# apps/web

Shell Next.js 16 em **static export**, sem servidor em produção. A UI lê e escreve só no banco local;
a rede é detalhe da camada de sync. Arquitetura completa em [frontend.md](../../docs/architecture/frontend.md);
o contrato (status, cabeçalhos, `type` de erro, prazos) vem só de [backend.md](../../docs/architecture/backend.md).

Hoje existem `src/app/` (o shell no grupo `(app)`; `/login` e `/signup` fora dele), `src/shared/` (`api/`, `auth/`, `db/`, `sync/`, `components/`),
`src/shared/auth/` (a sessão: access token em memória, refresh em aba única com `refreshLock.ts`, renovação ao abrir e ao voltar a rede, com o refresh sem resposta e sem token reagendado pelo `Retry-After` ou pelo backoff em vez de expirar ([ADR 0062](../../docs/decisions/0062-o-429-ou-5xx-no-refresh-de-abertura-nao-expira-a-sessao-fica-renewing-e-tenta-de-novo-depois-do-retry-after-ou-do-backoff-210.md)), e o `unauthorized` que o client renova e reenvia com a mesma requisição, [ADR 0045](../../docs/decisions/0045-o-unauthorized-se-renova-no-client-que-reenvia-a-mesma-requisicao-refresh-sem-resposta-nao-expira-a-sessao-token-renovado-de-outro-usuario-nao-vale.md); a janela offline de 72 h em `offline-window.ts` e `useOfflineWindow.ts`, sobre o relógio injetável `src/shared/clock.ts`), `src/shared/db/wipe.ts` e `src/features/local-store/services/device-session.ts` (entrar, trocar de usuário com o aviso e sair com limpeza, [ADR 0046](../../docs/decisions/0046-troca-de-usuario-e-saida-o-token-novo-so-vira-sessao-depois-de-confirmar-a-limpeza-esvazia-a-outbox-antes-do-deletedatabase-e-a-janela-offline-sem-data-conta-como-vencida.md), com os hooks `useDeviceAuth.ts` e `useSignOut.ts`),
os avisos passageiros do sync em `src/shared/sync/notices.ts` (o `locked` adota o `current` e avisa), mostrados no `Toaster` do shell pelo `useSyncNotices.ts`,
`src/sw.ts` (service worker, [ADR 0032](../../docs/decisions/0032-serwist-pelo-cli-sobre-o-static-export-build-com-turbopack.md)), `src/features/clients/` e `src/features/properties/` (telas de clientes e imóveis sobre a outbox vinda do spike 1a, [ADR 0030](../../docs/decisions/0030-tanstack-db-mantido-apos-o-spike-1a-outbox-persistida-contra-o-upsertclient.md), com o CPF/CNPJ, o telefone e o CEP digitados com máscara pelo `MaskedInput` e guardados sem ela, [ADR 0063](../../docs/decisions/0063-o-telefone-e-guardado-so-com-digitos-a-api-normaliza-a-entrada-com-mascara-ou-55-so-numeros-brasileiros-e-a-mascara-e-so-da-ui-215.md), com `If-Match`, a recusa `validation` e o conflito `version-conflict` guardados em `drafts`, e o `ConflictResolver` em `/clients/conflict` e `/properties/conflict`; nestas telas e na de campo, um id que o aparelho não tem é buscado pelo `GET`, `shared/sync/fetch.ts`; o pull por delta de clientes, imóveis, roteiros e vistorias, sem tocar registro com pendência e com o resync que varre no fim, fica em `shared/sync/pull.ts` e `pull-triggers.ts`, com o harness de teste em `pull.harness.ts`, [ADR 0041](../../docs/decisions/0041-o-pull-nao-toca-registro-com-pendencia.md), [ADR 0042](../../docs/decisions/0042-pull-grava-a-pagina-antes-do-cursor-e-reaplica-sem-efeito.md), [ADR 0043](../../docs/decisions/0043-rascunho-limpo-nao-segura-o-pull-e-o-resync-varre-no-fim.md) e [ADR 0044](../../docs/decisions/0044-o-pull-nao-aplica-resposta-mais-velha-que-o-aparelho-e-a-fila-conta-como-pendencia.md), que conta a fila da outbox como pendência e não aplica resposta lida antes de uma confirmação daqui; a store confirmada é lida por chave, pelo `readConfirmed` de `shared/db/local-db.ts`, e a idade de uma `version` vem do rowversion, em `shared/sync/version.ts`, [ADR 0047](../../docs/decisions/0047-lista-de-vistorias-em-paginas-de-50-e-pull-lendo-a-store-por-chave-pela-ordem-do-rowversion-resultado-do-spike-2-134.md); depois do primeiro pull completo, o `GET` por id não sai mais), `src/features/inspections/` (a lista, em páginas de 50 com "Mostrar mais", lida do resumo de cada vistoria com a fila por cima, com a busca e os filtros locais por cliente, imóvel, tipo, status e período antes da página, guardados na URL e devolvidos pelo `?voltar=`, e a vistoria completa só por id, numa collection `on-demand` de `src/shared/db/summarized-collection.ts` que grava a vistoria e o resumo na mesma transação, [ADR 0048](../../docs/decisions/0048-a-lista-de-vistorias-le-um-resumo-gravado-na-mesma-transacao-e-a-vistoria-completa-carrega-por-id.md); a nova vistoria (a entrada copia, com ids novos, um roteiro do aparelho escolhido, ou o roteiro padrão embutido num aparelho sem nenhum), a tela de campo (com ambientes e itens incluídos, renomeados, removidos e reordenados no formulário, os itens em edição por ambiente e os ambientes no `Sheet` do "···", a fila só com a estrutura válida, [ADR 0058](../../docs/decisions/0058-a-tela-de-campo-edita-a-estrutura-no-formulario-ids-em-roomid-itemid-position-do-indice-itens-num-modo-de-edicao-por-ambiente-e-ambientes-num-sheet-a-fila-espera-nomes-validos-o-recarregar-com-a-tela-aberta-vira-merge-de-tres-vias-171.md)), a conclusão pela outbox (o `completeInspectionSchema`, o Dialog, a tela só leitura e o `completedAt` e o `completedBy` no registro, [ADR 0050](../../docs/decisions/0050-a-vistoria-local-guarda-o-completedat-do-servidor-fora-do-corpo-do-put-a-conclusao-encerra-o-rascunho-e-a-conclusao-recusada-volta-para-inprogress-179.md) e [ADR 0053](../../docs/decisions/0053-a-autoria-da-conclusao-e-gravada-pelo-servidor-com-o-nome-copiado-e-as-concluidas-de-antes-ganham-a-do-dono-183.md)), o histórico do imóvel em `/properties/edit?id=` (as vistorias dele numa linha do tempo, pela data de início, num Card ao lado do formulário a partir de 1280 px, pelo `useIsWide` de `src/shared/useIsDesktop.ts`, e em abas com o `?tab=` abaixo disso; a tela de campo e o laudo voltam pelo `?voltar=`, só com caminho do app, [ADR 0060](../../docs/decisions/0060-o-historico-do-imovel-e-uma-linha-do-tempo-pela-data-de-inicio-em-abas-abaixo-de-1280-px-e-num-card-ao-lado-do-formulario-acima-e-a-tela-de-campo-e-o-laudo-voltam-pelo-voltar-so-com-caminho-do-app-176.md)), o laudo em `/inspections/report`, só leitura local e só da conclusão confirmada, impresso pelo CSS (`@page` no `globals.css` e classes `print:`, [ADR 0054](../../docs/decisions/0054-o-laudo-so-abre-com-a-conclusao-confirmada-pelo-servidor-e-a-impressao-fica-no-css-do-navegador-168.md)), a exclusão pela outbox e o `ConflictResolver` em `/inspections/conflict`, nos tipos edição, excluído e exclusão alterada, com o rascunho em `drafts` guardando valores e ambiente, [ADR 0036](../../docs/decisions/0036-rascunho-da-vistoria-guarda-o-passo-e-fica-ate-concluir.md), [ADR 0039](../../docs/decisions/0039-exclusao-de-vistoria-pela-outbox-marca-otimista-compactacao-por-exclusao-e-delete-decidido-no-envio.md) e [ADR 0040](../../docs/decisions/0040-conflitos-da-exclusao-tipo-no-rascunho-current-adotado-no-412-e-recriar-com-ids-novos.md)), `src/features/templates/` (os roteiros no banco local, com o laço do pull antes das vistorias e o `upsertTemplate` na outbox, e as telas: a lista em `/templates`, o editor em `/templates/edit`, com ambientes e itens em `useFieldArray`, os ambientes prontos do catálogo de `models/room-catalog.ts` (a fonte única, de onde sai também o roteiro padrão embutido da Nova vistoria) no Sheet "Adicionar ambientes", dois níveis no celular pelo `onBack` do `PageHeader` e o arrasto pela alça e pelo teclado com o dnd-kit, e o `ConflictResolver` em `/templates/conflict`, no merge plano com `rooms` como um campo só, [ADR 0057](../../docs/decisions/0057-o-editor-de-roteiro-reordena-com-o-dnd-kit-pela-alca-e-pelo-teclado-e-o-conflito-de-roteiro-fica-no-merge-plano-com-os-ambientes-como-um-campo-so-173.md)) e `src/features/local-store/` (o banco local do usuário e a outbox única, serial e com compactação, [ADR 0034](../../docs/decisions/0034-outbox-serial-uma-transacao-por-vez-na-ordem-de-criacao.md));
a árvore descrita em [Estrutura de pastas](../../docs/architecture/frontend.md#estrutura-de-pastas) é o alvo.
TanStack DB e `@tanstack/offline-transactions` têm versão exata: antes de mudar, ler a documentação da versão
instalada (`node_modules/@tanstack/*/skills/`), não a memória.

## Camadas e fronteiras de import

Fluxo: models → schemas → services → hooks → components → page.

| Camada | Pode importar | Nunca importa |
| --- | --- | --- |
| page | hooks, components | services, `api/` |
| components | Sanjou UI, outros components | hooks de dados, services |
| hooks | services, schemas | `api/generated` direto |
| services | models, schemas, `shared/*` | React |

Essas fronteiras são regra, não convenção (viram regras de lint).

## Regras

- **Erro se decide pelo `ProblemType`, nunca pelo status HTTP.** `handleProblem` em `shared/api/problems.ts`
  faz `switch` exaustivo; um `type` novo tem de quebrar o build até ganhar reação.
- **Nunca editar `src/shared/api/generated/`.** É saída do gerador OpenAPI; muda via `pnpm gen:api`.
- **`If-Match` e `Idempotency-Key` só na outbox** (`shared/sync/outbox.ts`), nunca em componente ou hook.
- **Rotas sem segmento dinâmico.** Nada de `[id]`: o id vai na query string (`/inspections/edit?id=`),
  lido com `useSearchParams` dentro de `Suspense`. Static export não aceita rota dinâmica com id de runtime.
- Proibido no static export: Server Components com dados, Server Actions, middleware, rotas de API, ISR.
- **Usar os componentes do Sanjou UI e nunca recriá-los** com `div` e classes. Componente que falta é
  componente local em `src/shared/components/`, só com primitivos e tokens do Sanjou
  ([ADR 0020](../../docs/decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)); se for
  genérico, entra em "Candidatos ao Sanjou".
- **A caixa da tabela das listas usa `overflow-clip`, nunca `overflow-hidden`**: no `main` flex do shell, ela encolheria e
  cortaria as linhas. O cabeçalho fixo é o `STICKY_TABLE_HEADER` de `shared/components/list-table.ts` ([ADR 0064](../../docs/decisions/0064-no-desktop-a-pagina-rola-inteira-a-tabela-das-listas-tem-overflow-clip-e-o-cabecalho-fixo-e-o-container-do-table-do-sanjou-so-rola-abaixo-do-min-w-222.md)).
- React Compiler ligado: sem `useMemo`/`useCallback` manuais; no react-hook-form, `useWatch`/`useFormState`, nunca `watch()`.
- **Next 16 muda APIs e convenções.** Antes de usar uma API do Next, consultar a documentação da versão
  instalada em `node_modules/next/dist/docs/`, não a memória.

## Comandos (rodar dentro de `apps/web` ou com `pnpm --filter web`)

`dev`, `build` (`next build` + `serwist build`), `lint` (Oxlint), `format` (Oxfmt), `typecheck` (app e `tsconfig.sw.json`),
`test` (Vitest), `check` (lint + typecheck + test). O service worker só registra no build de produção.

## Figma → Sanjou

Instância da biblioteca Sanjou UI → subpath com o mesmo nome; mapa completo, com variantes e componentes
locais, em [figma-sanjou.md](../../docs/architecture/figma-sanjou.md). Sem Code Connect.

| No Figma | Import |
| --- | --- |
| Button, Badge, Input, Textarea, Label, Separator, Skeleton | `import { Button } from "@sanjou/ui/button"` (um subpath por nome) |
| Toast (avisos passageiros) | `import { Toaster } from "@sanjou/ui/sonner"`, montado no shell; o aviso sai com `toast()` do `sonner` (ADR 0033) |
| Alert, Avatar | `import { Alert, AlertTitle, AlertDescription } from "@sanjou/ui/alert"`, `import { Avatar, AvatarFallback } from "@sanjou/ui/avatar"` |
| TableHead, TableCell | `import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@sanjou/ui/table"` |
| DialogContent, SelectTrigger | `import { Dialog, DialogContent } from "@sanjou/ui/dialog"`, `import { Select, SelectTrigger } from "@sanjou/ui/select"` |
| DropdownMenu | `import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@sanjou/ui/dropdown-menu"` |
| Form item | `import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@sanjou/ui/form"` (react-hook-form, ADR 0023) |
| Icon/* | `import { Check } from "lucide-react"` (mesmo nome) |
| Avis/Mark, Avis/Lockup | `import { AvisMark } from "@/shared/components/avis-mark"`, `import { AvisLockup } from "@/shared/components/avis-lockup"` (marca, ADR 0029) |
| Auth layout, Auth form / Sign in, Auth form / Create account | `AuthLayout`, `SignInForm`, `SignUpForm` de `@/shared/components/auth-layout`, `sign-in-form`, `sign-up-form` (ADR 0019) |
| Componentes novos | Locais em `@/shared/components/` (ADR 0020) |

## Candidatos ao Sanjou

Componentes locais genéricos que sobem em bloco na próxima release do Sanjou (ADR 0020). No Figma,
levam "Candidato ao Sanjou" na descrição. Uma linha por componente: nome, caminho, motivo.

- `NavItem`, `Sidebar`, `BottomNav` (`src/shared/components/nav.tsx`): navegação de app com sidebar no desktop e barra inferior no celular; nada nela é do vistoria.
- `Sheet` (`src/shared/components/sheet.tsx`): drawer lateral e bottom sheet sobre o `Dialog` do Sanjou, que hoje só centraliza.
- `ListRow` (`src/shared/components/list-row.tsx`): linha de lista do celular que abre o registro, com título, subtítulo, meta e badges; serve a qualquer lista.
- `EmptyState` (`src/shared/components/empty-state.tsx`): estado vazio de lista com ícone, título, descrição e ação; nada nele é do vistoria.
- `ToggleGroup`, `ToggleGroupItem` (`src/shared/components/toggle-group.tsx`): escolha única em chips com semântica de radiogroup, inválido e somente leitura; serve a qualquer escolha curta, não só à condição do item.
- `StepperForm`, `StepperFormStep` (`src/shared/components/stepper-form.tsx`): formulário em etapas com estado por etapa, coluna quando o próprio formulário tem largura (a variante `stepper-wide`, por container query) e faixa de chips abaixo disso; o vistoria só passa as etapas e o conteúdo. O `ToggleGroup` no tamanho `stepper` segue a mesma variante.
- `SortableItem` (`src/shared/components/sortable-item.tsx`): linha de lista reordenável pela alça, com texto ou campo, selecionada e levantada; quem arrasta entra pelas props, então serve a qualquer lista e a qualquer biblioteca de arrasto.
- `Timeline`, `TimelineItem` (`src/shared/components/timeline.tsx`): linha do tempo de registros, um ponto por item numa trilha vertical, com o marcador do estado, o que quem usa passar embaixo da meta e o item inteiro como link; serve a qualquer histórico.
- `SortableList`, `SortableRow` (`src/shared/components/sortable-list.tsx`): a lista que reordena o `SortableItem` com o dnd-kit, pelo ponteiro e pelo teclado, com os anúncios em português; serve ao roteiro e à tela de campo, e a qualquer lista ordenável.
- `FilterSelect` (`src/shared/components/filter-select.tsx`): filtro de lista em Select, com o item "todos" e dois arranjos, o nome no texto na barra do desktop e o Label em cima no painel do Sheet; os itens só existem com o Select aberto (o Select do Radix monta os itens fechado também); serve aos filtros com poucas opções (Tipo, Status, Período) e a qualquer lista filtrável.
- `SearchSelect` (`src/shared/components/search-select.tsx`): escolha numa lista longa, com o gatilho do SelectTrigger e, aberto, o Popover do Sanjou com a busca sem acento e no máximo 50 opções montadas, o "todos" e o escolhido sempre visíveis; `combobox` e `listbox`, com setas, Enter e Esc; serve aos filtros (barra e painel) e aos formulários, dentro do `FormControl` ([ADR 0065](../../docs/decisions/0065-escolha-numa-lista-longa-e-um-searchselect-com-busca-e-no-maximo-50-opcoes-montadas-sobre-o-popover-do-sanjou-225.md)). É o Combobox que falta no Sanjou.
- `MaskedInput` (`src/shared/components/masked-input.tsx`): Input que mascara o que se digita ou cola e mantém o cursor no lugar, contando as letras e os dígitos antes dele; a máscara vem de quem usa, então serve a qualquer campo com máscara (CPF/CNPJ, telefone e CEP aqui).
