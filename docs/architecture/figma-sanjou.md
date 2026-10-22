# Figma → Sanjou

O mapa de cada componente do arquivo [vistoria — app](https://www.figma.com/design/BJDaQ12Mlx1YCdKwjETHmE/vistoria-%E2%80%94-app) para o import no código. É usado pelo `/screen` e por quem implementa uma tela a partir de um frame ([Das telas no Figma para o código](../vision.md#das-telas-no-figma-para-o-código)). O resumo fica em [`apps/web/CLAUDE.md`](../../apps/web/CLAUDE.md#figma--sanjou).

Levantado em 2026-10-19 (issue #13), pelo MCP do Figma, nas páginas Telas, Wireframes e Componentes novos, contra `@sanjou/ui` 0.2.0. O teste `apps/web/src/shared/figma-sanjou-map.test.ts` confere que cada import de `@sanjou/ui` e de `lucide-react` deste arquivo existe no pacote instalado.

## Como ler um frame

- **Instância da biblioteca Sanjou UI → import do subpath do Sanjou.** A descrição do componente no Figma começa pelo arquivo e pelos exports (`button.tsx · buttonVariants`), e o `get_design_context` devolve essa descrição.
- **Não há Code Connect.** A biblioteca não tem mapeamento publicado (`get_code_connect_map` volta vazio); a fonte é este mapa.
- **`state` é só de design.** `hover` e `focus` não viram prop. `disabled` vira a prop `disabled`. `invalid` vira `aria-invalid` (no formulário, o `FormControl` cuida disso).
- **Propriedades de texto e de ícone** (`label`, `title`, `icon start swap`...) viram `children`. O ícone vem de `lucide-react`.
- **Componente local** (página Componentes novos) → `@/shared/components/` ([ADR 0020](../decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)). Nunca recriar com `div` o que está na tabela da biblioteca.

## Biblioteca Sanjou UI

| No Figma | Import | Variantes do Figma → props |
| --- | --- | --- |
| Button | `import { Button } from "@sanjou/ui/button"` | `variant` primary, secondary, outline, ghost, brand, destructive · `size` sm, md, lg, icon (botão só com ícone leva `aria-label`) |
| Badge | `import { Badge } from "@sanjou/ui/badge"` | `variant` neutral, outline, brand, success, warning, danger · `dot` |
| Alert | `import { Alert, AlertTitle, AlertDescription } from "@sanjou/ui/alert"` | `variant` neutral, brand, success, warning, danger · `title` → `AlertTitle`, `description` → `AlertDescription`, ícone como primeiro filho |
| Avatar | `import { Avatar, AvatarFallback, AvatarImage } from "@sanjou/ui/avatar"` | `size` sm, md, lg · `type=fallback` → `AvatarFallback` com as iniciais · `type=image` → `AvatarImage` com `alt` |
| Input | `import { Input } from "@sanjou/ui/input"` | `placeholder` → prop `placeholder` |
| Textarea | `import { Textarea } from "@sanjou/ui/textarea"` | Igual ao Input; cresce com o conteúdo |
| Label | `import { Label } from "@sanjou/ui/label"` | Fora de formulário; dentro dele, `FormLabel` |
| SelectTrigger | `import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@sanjou/ui/select"` | `placeholder` → `SelectValue placeholder` |
| Separator | `import { Separator } from "@sanjou/ui/separator"` | `orientation` horizontal, vertical |
| TableHead, TableCell | `import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@sanjou/ui/table"` | `type` numeric → `className="text-right tabular-nums"` · actions → `Button` ghost `size="icon"` com `aria-label` · badge → `SyncBadge` ou `Badge` na célula |
| DialogContent, DialogOverlay | `import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@sanjou/ui/dialog"` | O overlay vem dentro do `DialogContent` · `close button` → `showCloseButton` · `footer` → `DialogFooter` |
| DropdownMenu (o menu do usuário, "usuário (abre DropdownMenu)" no Shell) | `import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from "@sanjou/ui/dropdown-menu"` | Conteúdo não desenhado: o nome em `DropdownMenuLabel` e "Sair" em `DropdownMenuItem` (nota do frame Shell) |
| Form item | `import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@sanjou/ui/form"` | Exige `react-hook-form` ([ADR 0023](../decisions/0023-formularios-com-react-hook-form.md)) · `invalid` vem do erro do campo, não de prop · controle trocado no Figma (Textarea, Select) vai dentro do `FormControl` |

**Auth layout, Auth form / Sign in e Auth form / Create account** são um pattern do registry do Sanjou, sem subpath no pacote. Viram componentes locais, compostos com os componentes acima ([ADR 0019](../decisions/0019-login-da-v1-com-o-pattern-auth-do-sanjou.md), [ADR 0020](../decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)):

- `AuthLayout` (`@/shared/components/auth-layout`): no lugar do Image placeholder, o painel escuro do ícone do app (fundo `gray-12`, `AvisMark` com arco claro e luz `indigo-11`), porque o guia da marca não usa o índigo como fundo.
- `SignInForm` e `SignUpForm` (`@/shared/components/sign-in-form`, `@/shared/components/sign-up-form`), sobre a base `AuthForm` (`@/shared/components/auth-form`): lockup, título, aviso opcional (`SessionExpired`), erro do formulário num `Alert` danger, campos com `Form` do Sanjou e o link para a outra tela. O Toast das notas do Figma vira esse `Alert`: o Sonner não está no mapa.

## Ícones

`Icon/<Nome>` no Figma, da biblioteca ou local, vira `<Nome>` de `lucide-react` 0.525, a versão que o Sanjou usa. O `lucide-react` é dependência direta do web desde o shell (#71), fixado na mesma versão.

- Da biblioteca: `import { Check, ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, TriangleAlert, Trash2, X } from "lucide-react"`
- Locais (o Sanjou ainda não tem; candidatos): `import { Building2, ChevronLeft, ClipboardList, Clock, Cloud, CloudAlert, CloudOff, FilePen, GripVertical, House, ListChecks, Printer, RefreshCw, Search, SlidersHorizontal, Smartphone } from "lucide-react"`

## Componentes locais

Ficam todos em `apps/web/src/shared/components/` e são feitos só com primitivos e tokens do Sanjou ([ADR 0020](../decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)). Cada um nasce com a primeira tela que o usa; hoje existem os da marca (`AvisMark` e `AvisLockup`, #62), os do shell (`Nav`, `Sheet`, `SyncStatus`, `OfflineBanner`, `OutboxPanel`, #71) e os do acesso (`AuthLayout`, `AuthForm`, `SignInForm`, `SignUpForm`, `SessionExpired`, #72). O menu do usuário do shell é `UserMenu` (`@/shared/components/user-menu`), composto com Avatar e DropdownMenu do Sanjou. Os candidatos entram em "Candidatos ao Sanjou" no `apps/web/CLAUDE.md` quando forem criados.

| No Figma (nó) | Import | Variantes | Tipo |
| --- | --- | --- | --- |
| Nav/Item (11:812), Nav/Sidebar (11:813), Nav/Barra inferior (11:882) | `import { NavItem, Sidebar, BottomNav } from "@/shared/components/nav"` | `layout` sidebar, barra · `estado` ativo, inativo | Candidato |
| Sheet (12:1253) | `import { Sheet } from "@/shared/components/sheet"` | `lado` direita, baixo | Candidato |
| SyncStatus (12:1307) | `import { SyncStatus } from "@/shared/components/sync-status"` | `estado` sincronizado, enviando, offline, requer ação · `tamanho` completo, compacto | Específico |
| OfflineBanner (12:1345) | `import { OfflineBanner } from "@/shared/components/offline-banner"` | `tipo` aviso, bloqueio | Específico |
| OutboxPanel (13:1153), OutboxPanel/Item (13:932) | `import { OutboxPanel, OutboxPanelItem } from "@/shared/components/outbox-panel"` | `lado` direita, baixo · item: `estado` pendente, enviando, travada, conflito, rejeitada | Específico |
| SyncBadge (25:1053) | `import { SyncBadge } from "@/shared/components/sync-badge"` | `estado` local, enviando, sincronizado, conflito, rejeitado | Específico |
| FieldSyncIndicator (25:1083) | `import { FieldSyncIndicator } from "@/shared/components/field-sync-indicator"` | `estado` igual ao SyncBadge | Específico |
| StepperForm (27:1220), StepperForm/Etapa (26:1145) | `import { StepperForm, StepperFormStep } from "@/shared/components/stepper-form"` | `layout` desktop, celular · etapa: `estado` pendente, completa, erro, conflito · `atual` | Candidato |
| DraftResume (29:1342) | `import { DraftResume } from "@/shared/components/draft-resume"` | `estado` local, enviando, conflito, rejeitado · `layout` largo, estreito | Específico |
| SessionExpired (29:1393) | `import { SessionExpired } from "@/shared/components/session-expired"` | `caso` pela prop `pending`: com pendências (> 0, `Alert` warning), sem pendências (0, `Alert` neutral) · outro usuário fica para o M4 (sem wipe) | Específico |
| ConflictResolver (32:1787), ConflictResolver/Campo (30:1431) | `import { ConflictResolver, ConflictField } from "@/shared/components/conflict-resolver"` | `tipo` edição, excluído, exclusão alterada · campo: `escolha` nenhuma, meu, servidor | Específico |
| ToggleGroup (41:1661), ToggleGroup/Item (41:1610) | `import { ToggleGroup, ToggleGroupItem } from "@/shared/components/toggle-group"` | `tamanho` md, lg · item: `estado` padrão, inválido, somente leitura | Candidato |
| InspectionItem (42:1758) | `import { InspectionItem } from "@/shared/components/inspection-item"` | `layout` desktop, celular · `tipo` entrada, saída | Específico |
| ListRow (64:1706) | `import { ListRow } from "@/shared/components/list-row"` | — | Candidato |
| EmptyState (64:1722) | `import { EmptyState } from "@/shared/components/empty-state"` | — | Candidato |
| SortableItem (64:1818) | `import { SortableItem } from "@/shared/components/sortable-item"` | `tipo` texto, campo · `estado` padrão, selecionado | Candidato |
| Avis/Mark (103:1744) | `import { AvisMark } from "@/shared/components/avis-mark"` | `size` default, small (no código, pelo tamanho: small abaixo de 32 px) | Específico (marca) |
| Avis/Lockup (103:1759) | `import { AvisLockup } from "@/shared/components/avis-lockup"` | `layout` horizontal, vertical · `legenda` (`caption`) | Específico (marca) |

Os nomes de export acima são o alvo. Se a implementação pedir outro nome, este arquivo muda no mesmo PR.
