# apps/web

Shell Next.js 16 em **static export**, sem servidor em produção. A UI lê e escreve só no banco local;
a rede é detalhe da camada de sync. Arquitetura completa em [frontend.md](../../docs/architecture/frontend.md);
o contrato (status, cabeçalhos, `type` de erro, prazos) vem só de [backend.md](../../docs/architecture/backend.md).

Hoje existem `src/app/` (o shell no grupo `(app)`; `/login` e `/signup` fora dele), `src/shared/` (`api/`, `auth/`, `db/`, `sync/`, `components/`),
`src/sw.ts` (service worker, [ADR 0032](../../docs/decisions/0032-serwist-pelo-cli-sobre-o-static-export-build-com-turbopack.md)) e `src/features/clients/` (telas de clientes sobre a outbox vinda do spike 1a, [ADR 0030](../../docs/decisions/0030-tanstack-db-mantido-apos-o-spike-1a-outbox-persistida-contra-o-upsertclient.md), com `If-Match` e a recusa `validation` guardada em `drafts`);
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
