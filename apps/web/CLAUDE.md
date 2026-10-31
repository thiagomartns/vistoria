# apps/web

Shell Next.js 16 em **static export**, sem servidor em produção. A UI lê e escreve só no banco local;
a rede é detalhe da camada de sync. Arquitetura completa em [frontend.md](../../docs/architecture/frontend.md);
o contrato (status, cabeçalhos, `type` de erro, prazos) vem só de [backend.md](../../docs/architecture/backend.md).

Hoje existem `src/app/` (o shell no grupo `(app)`; `/login` e `/signup` fora dele), `src/shared/` (`api/`, `auth/`, `db/`, `sync/`, `components/`),
`src/shared/auth/` (a sessão: access token em memória, refresh em aba única com `refreshLock.ts`, renovação ao abrir e ao voltar a rede, e o `unauthorized` que o client renova e reenvia com a mesma requisição, [ADR 0045](../../docs/decisions/0045-o-unauthorized-se-renova-no-client-que-reenvia-a-mesma-requisicao-refresh-sem-resposta-nao-expira-a-sessao-token-renovado-de-outro-usuario-nao-vale.md)),
`src/sw.ts` (service worker, [ADR 0032](../../docs/decisions/0032-serwist-pelo-cli-sobre-o-static-export-build-com-turbopack.md)), `src/features/clients/` e `src/features/properties/` (telas de clientes e imóveis sobre a outbox vinda do spike 1a, [ADR 0030](../../docs/decisions/0030-tanstack-db-mantido-apos-o-spike-1a-outbox-persistida-contra-o-upsertclient.md), com `If-Match`, a recusa `validation` e o conflito `version-conflict` guardados em `drafts`, e o `ConflictResolver` em `/clients/conflict` e `/properties/conflict`; nestas telas e na de campo, um id que o aparelho não tem é buscado pelo `GET`, `shared/sync/fetch.ts`; o pull por delta de clientes, imóveis e vistorias, sem tocar registro com pendência e com o resync que varre no fim, fica em `shared/sync/pull.ts` e `pull-triggers.ts`, com o harness de teste em `pull.harness.ts`, [ADR 0041](../../docs/decisions/0041-o-pull-nao-toca-registro-com-pendencia.md), [ADR 0042](../../docs/decisions/0042-pull-grava-a-pagina-antes-do-cursor-e-reaplica-sem-efeito.md), [ADR 0043](../../docs/decisions/0043-rascunho-limpo-nao-segura-o-pull-e-o-resync-varre-no-fim.md) e [ADR 0044](../../docs/decisions/0044-o-pull-nao-aplica-resposta-mais-velha-que-o-aparelho-e-a-fila-conta-como-pendencia.md), que conta a fila da outbox como pendência e não aplica resposta lida antes de uma confirmação daqui; depois do primeiro pull completo, o `GET` por id não sai mais), `src/features/inspections/` (a lista, a nova vistoria pelo roteiro fixo, a tela de campo, a exclusão pela outbox e o `ConflictResolver` em `/inspections/conflict`, nos tipos edição, excluído e exclusão alterada, com o rascunho em `drafts` guardando valores e ambiente, [ADR 0036](../../docs/decisions/0036-rascunho-da-vistoria-guarda-o-passo-e-fica-ate-concluir.md), [ADR 0039](../../docs/decisions/0039-exclusao-de-vistoria-pela-outbox-marca-otimista-compactacao-por-exclusao-e-delete-decidido-no-envio.md) e [ADR 0040](../../docs/decisions/0040-conflitos-da-exclusao-tipo-no-rascunho-current-adotado-no-412-e-recriar-com-ids-novos.md)) e `src/features/local-store/` (o banco local do usuário e a outbox única, serial e com compactação, [ADR 0034](../../docs/decisions/0034-outbox-serial-uma-transacao-por-vez-na-ordem-de-criacao.md));
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
- `StepperForm`, `StepperFormStep` (`src/shared/components/stepper-form.tsx`): formulário em etapas com estado por etapa, coluna no desktop e faixa de chips no celular; o vistoria só passa as etapas e o conteúdo.
