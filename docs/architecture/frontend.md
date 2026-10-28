# Arquitetura Frontend — App local-first

## Tese e princípios

O front é um app **local-first** servido por um shell Next.js sem servidor em produção. O .NET é a única fonte de verdade e a única fronteira de segurança. A ousadia está na camada de dados e na UX de sincronização, não no framework.

O contrato de sync (rotas, cabeçalhos, catálogo de erros, prazos e decisões) vive no documento do backend ([Arquitetura Backend — API .NET para app local-first](backend.md)). Este documento descreve como o cliente cumpre esse contrato e **nunca redefine** um status, cabeçalho ou valor. Onde um número aparece aqui, ele vem da seção [Parâmetros compartilhados](backend.md#parâmetros-compartilhados) de lá.

1. **Local antes de remoto.** Toda leitura e escrita da UI acontece contra o banco local. A rede é detalhe de sincronização.
2. **Next como shell, não como backend.** Static export, sem Server Components com dados, Server Actions, rotas de API ou middleware.
3. **.NET é a autoridade.** O cliente valida para UX; o servidor valida para valer.
4. **Contrato gerado, não escrito.** `models`, schemas Zod e a union `ProblemType` saem do OpenAPI do .NET.
5. **Reação pelo `type` do erro, nunca pelo status.** Cada `type` do catálogo tem uma reação, e o `switch` é exaustivo.
6. **Rascunho é entidade.** Formulário profundo é um registro local com ciclo de vida.
7. **Estado de sync é linguagem visual.** O usuário sempre sabe o que está só no aparelho, o que está subindo e o que precisa dele.
8. **Ousar em uma camada, ser chato nas outras.**

## Visão geral

> Diagrama: camadas do front até o .NET · leitura local, escrita via outbox (disponível na versão original do documento)

A tela nunca espera a rede: lê do banco local e escreve na outbox. O sync empurra a outbox para o .NET e puxa de volta o que mudou, sempre pela camada de services.

## Stack

O risco está concentrado numa peça: TanStack DB, ainda pré-1.0. Todo o resto é maduro ou nativo do navegador.

| Camada | Escolha | Risco | Observação |
| --- | --- | --- | --- |
| Shell / roteamento | Next.js 16, App Router, static export | Baixo | Sem servidor Next em produção |
| UI | Sanjou UI sobre Radix + Tailwind CSS 4 | Baixo | Componentes de sync são do app, feitos com primitivos do Sanjou ([ADR 0020](../decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)) |
| Dados locais | TanStack DB + `@tanstack/offline-transactions` | **Médio** | Pré-1.0; isolado em `services/` |
| Sync | Delta + outbox sobre a REST do .NET | Médio | Sem infraestrutura extra |
| Formulários | react-hook-form + Zod, com o `Form` do Sanjou | Baixo | Zod gerado do contrato ([ADR 0023](../decisions/0023-formularios-com-react-hook-form.md)) |
| Contrato | `@hey-api/openapi-ts` | Baixo | Tipos, client, Zod e `ProblemType` |
| Coordenação entre abas | Web Locks API + `BroadcastChannel` | Baixo | Nativo do navegador |
| PWA | Serwist | Baixo | `serwist build` depois do `next build`, sobre o `out/` ([ADR 0032](../decisions/0032-serwist-pelo-cli-sobre-o-static-export-build-com-turbopack.md)) |
| Compilação | React Compiler | Baixo | Sem `useMemo`/`useCallback` manuais |
| Lint / format | Oxlint + Oxfmt | Baixo | Reversível |
| Testes | Vitest + Playwright | Baixo | Playwright simula rede cortada e várias abas |

Um sync engine dedicado (PowerSync) está fora do escopo; só volta à mesa se o spike 2 mostrar que o delta via REST não dá conta.

## Contrato .NET → TypeScript

O documento OpenAPI 3.1 do .NET (`apps/api/openapi.json`, o mesmo servido em `/openapi/v1.json`) gera `models`, schemas Zod, o client HTTP e a union `ProblemType`. Nenhum DTO ou tipo de erro é escrito à mão no front.

**O que o front recebe do contrato**

- Funções com o nome do `operationId`: `getInspection`, `upsertInspection`, `deleteInspection`, `syncInspections`, os equivalentes de `clients`, `properties` e `templates`, e `signUp`, `signIn`, `refreshToken`, `signOut`.
- `ProblemType` como union TypeScript. O tratamento de erro faz `switch` exaustivo sobre ela: um `type` novo no backend quebra o build até ganhar uma reação.
- `version` em base64 nos DTOs, igual ao `ETag` sem aspas.
- Erros por campo com o caminho JSON em camelCase (`rooms[2].items[4].condition`). O react-hook-form usa `rooms.2.items.4.condition`: uma função única, com teste, converte entre os dois ([ADR 0023](../decisions/0023-formularios-com-react-hook-form.md)).

**No front**

- `pnpm gen:api` lê o `apps/api/openapi.json` commitado e roda o gerador, sem precisar da API rodando (nem no CI). A saída (`src/shared/api/generated/`) é commitada, para o diff do contrato aparecer no PR. O CI falha se ela estiver desatualizada.
- O gerador fica em `scripts/gen-api/`, com `@hey-api/openapi-ts` e TypeScript 6 fixados: ele usa a API JS do compilador, que o TypeScript 7 do web não expõe. O código gerado passa pelo `tsc` do web, mas não pelo Oxlint nem pelo Oxfmt.
- `shared/api/client.ts` configura o client gerado: URL da API em `NEXT_PUBLIC_API_URL` (vazia em produção, mesma origem; `http://localhost:8080` por padrão no `next dev`), `Authorization` em toda chamada, com o access token lido da memória, e `credentials: 'include'` só nas chamadas a `/auth/*` (necessário em dev, onde front e API estão em portas diferentes). `readFailure` transforma a falha de uma chamada em `ProblemDetails` validado pelo Zod gerado, falha de rede ou resposta ilegível.
- `If-Match` e `Idempotency-Key` são definidos só pela outbox, nunca por componente ou hook.

**Fronteira entre gerado e escrito à mão**

| Camada | Origem | Exemplo |
| --- | --- | --- |
| models | Gerado | `InspectionDto`, `RoomDto`, `InspectionItemDto`, `SyncPageDto` |
| schemas (servidor) | Gerado | `zInspectionDto` |
| schemas (UI) | Escrito, estendendo o gerado | `roomStepSchema` (avançar de ambiente) e `completeInspectionSchema` (concluir) |
| erros | Gerado + escrito | `ProblemType` gerado; `handleProblem()` escrito, com `switch` exaustivo |
| services | Escrito, usando o client gerado | Mapeia DTO ↔ registro local |

## Camada de dados local-first

Uma collection por entidade, persistida no aparelho, é a única fonte de leitura da UI. Escritas são aplicadas na hora (otimistas), gravadas na outbox e confirmadas ou revertidas pelo .NET.

> Diagrama: caminho de uma escrita · 3 resultados principais (disponível na versão original do documento)

O caminho feliz é invisível para o usuário. A tabela de reações abaixo cobre todos os outros resultados.

### Leitura (pull)

- Antes do delta, a leitura por id ([ADR 0038](../decisions/0038-escopo-do-m3-leitura-por-id-conflito-de-cadastro-e-exclusao.md)): abrir `/inspections/edit?id=`, `/clients/edit?id=` ou `/properties/edit?id=` com um id que não está no banco local e com rede busca por `getInspection`, `getClient` ou `getProperty`. A resposta vira a `serverShadow`, com a `version`, como depois de um envio aceito; a vistoria traz o imóvel e o cliente que faltarem. Registro com pendência nunca é sobrescrito. Sem rede, a tela explica que é preciso abrir uma vez com rede; 404 cai em "remover local". Com o delta (M4), esse `GET` fica só para o link aberto antes do primeiro pull.
- Um laço de pull por entidade (`syncInspections`, `syncClients`, `syncProperties`, `syncTemplates`), cada um com seu cursor, repetido enquanto `hasMore` for verdadeiro. Cada página é aplicada numa transação local junto com o novo cursor; se o pull cair no meio, retoma da última página aplicada.
- `items` fazem upsert do agregado inteiro (vistoria + ambientes + itens); `deletedIds` removem do banco local.
- Gatilhos: abrir o app, voltar a rede, a cada intervalo de pull com o app visível e logo depois que a outbox esvazia.
- Registro com pendência na outbox não é sobrescrito. A versão do servidor fica guardada como `serverShadow`, que é a base do merge.
- `cursor-expired` ou `invalid-cursor` → resync completo da entidade: apaga a collection (exceto registros com pendência), zera o cursor e puxa do zero.

### Escrita (push)

- Cada mudança vira uma transação na outbox: o agregado completo (vistoria com todos os ambientes e itens), a `baseVersion` e uma `Idempotency-Key` (UUID v7) gerada ao enfileirar.
- `baseVersion` nula (registro criado offline) → `PUT` sem `If-Match`. Caso contrário, `If-Match: "<baseVersion>"`.
- Transações do mesmo registro que **nunca foram enviadas** são compactadas na mais recente. Uma transação que já teve uma tentativa nunca é compactada, porque pode ter sido aplicada. A tentativa conta do início do envio: a marca é gravada antes da requisição sair, porque o `retryCount` do executor só sobe depois de uma falha (uma aba fechada no meio do envio volta com 0). Como o executor não deixa tirar uma transação da fila, a compactação acontece quando a mais antiga chega à frente: ela termina sem rede, e a mais nova, que leva o registro inteiro, sai no lugar dela.
- Uma transação por vez, na ordem de criação, numa fila só para todas as entidades: a dependência entre registros (cliente antes do imóvel, roteiro antes da vistoria) vem da ordem. Recusado o registro pai, o filho volta com erro no campo e vira rascunho ([ADR 0034](../decisions/0034-outbox-serial-uma-transacao-por-vez-na-ordem-de-criacao.md)).
- Sucesso: a `version` da resposta vira a `serverShadow` e a `baseVersion` da próxima transação daquele registro.
- Exclusão (só de vistoria em andamento): `deleteInspection` com `If-Match`; 204 é sucesso mesmo se ela já tinha sumido.
- Concluir é um `PUT` com `status: completed`. Na UI, a vistoria fica só leitura assim que o usuário conclui, antes mesmo da confirmação do servidor.

### Reação aos erros

A reação é escolhida pelo `type`, conforme o [catálogo do backend](backend.md#catálogo-de-erros), por `handleProblem` (`shared/api/problems.ts`). O `type` chega como URN (`urn:vistoria:problem:locked`); as tabelas abaixo usam só o slug. Falha de rede (sem resposta) e resposta que não é um `ProblemDetails` do contrato (como o HTML de um 502 do proxy) entram no primeiro grupo: a API não chegou a decidir nada, e descartar perderia o registro.

| Grupo | `type` | O que a outbox faz |
| --- | --- | --- |
| Tentar de novo | `internal`, `rate-limited`, `idempotency-in-progress`, falha de rede, resposta sem `ProblemDetails` | Backoff (ou `Retry-After`) com a **mesma** chave |
| Renovar sessão | `unauthorized` | Pausa a fila, refresh em aba única, retoma |
| Decisão do usuário | `version-conflict` (409 ou 412), `deleted` | Marca conflito e abre o `ConflictResolver` |
| Aceitar o servidor | `locked` | Descarta a transação, adota `current` e avisa que a vistoria foi concluída em outro aparelho |
| Voltar ao rascunho | `validation` | Status `rejected`, erros nos campos |
| Descartar e avisar | `forbidden` | Remove a transação, reverte o otimista, avisa |
| Bug | `idempotency-key-reused`, `precondition-required`, `unsupported-request` | Registra, descarta, mostra erro genérico |
| Resync | `cursor-expired`, `invalid-cursor` | Resync completo da entidade (pull) |
| Remover local | `not-found` | Remove o registro do banco local (só ocorre em `GET`) |
| Credencial inválida | `invalid-credentials` | Não passa pela outbox (só ocorre no `signIn`): o formulário mostra "E-mail ou senha incorretos." e não tenta refresh ([ADR 0027](../decisions/0027-credencial-invalida-com-type-proprio-invalid-credentials-complementando-o-adr-0018.md)) |

Transação que falha sem sucesso além do prazo de "travada" ganha destaque no `OutboxPanel`, mas continua tentando.

### Conflito

1. **Escrita própria.** Antes de qualquer merge, compara `current` (sem `version` e datas) com o corpo enviado. Se forem iguais, era a própria escrita cuja resposta se perdeu: é sucesso, e o front adota `current.version`.
2. **Merge de três vias** por campo, e por item via `Id`: base = `serverShadow`, local = rascunho, servidor = `current`. Campo que só um lado mudou é aceito automaticamente. Campo que os dois mudaram para valores diferentes vai para o `ConflictResolver`.
3. **Reenvio.** Resolvido o merge, nasce uma transação nova: `baseVersion = current.version` e **`Idempotency-Key` nova**, porque o corpo mudou (reusar a chave daria `idempotency-key-reused`).
4. **`deleted`.** "Excluído em outro aparelho": o usuário escolhe recriar (novo `Id`, mesmos dados) ou descartar.
5. **Conflito num `DELETE`.** "Foi alterado depois que você abriu. Excluir mesmo assim?" Confirmado, reenvia com `current.version` e chave nova.

Na vistoria (`inspections.merge.ts`), ambientes e itens se casam pelo `Id`. O que foi incluído de um lado entra. O que foi removido de um lado e ficou intocado do outro sai. O que foi removido de um lado e editado do outro colide, e o registro mesclado segue o local até a escolha. Um ambiente removido de um lado e mudado do outro, mesmo que só num item, é uma colisão só, no ambiente. A `position` nunca colide: vale o local, a lista é ordenada pela posição mesclada (no empate, primeiro a ordem do servidor) e renumerada de 0 a n−1. Mudar de posição porque um vizinho saiu não conta como edição.

Cliente e imóvel seguem os mesmos passos, com o merge plano por campo (sem itens) e o mesmo `ConflictResolver` ([ADR 0038](../decisions/0038-escopo-do-m3-leitura-por-id-conflito-de-cadastro-e-exclusao.md)).

Regras de negócio do agregado (como exigir condição em todos os itens para concluir) são reavaliadas pelo .NET no reenvio, nunca só no cliente.

## Formulários profundos

Todo formulário profundo é um registro na collection `drafts`, salvo a cada alteração. Fechar a aba, perder a rede ou trocar de tela nunca perde input.

> Diagrama: ciclo de vida do rascunho · 7 estados (disponível na versão original do documento)

O formulário segue editável com transações na fila: cada edição vira transação pelas regras da [Escrita (push)](#escrita-push), compactada ou encadeada. Ele só fica só leitura enquanto uma requisição do registro está em voo e depois de concluir ([ADR 0021](../decisions/0021-formulario-editavel-com-transacao-na-fila.md)). Rejeição (`validation`) volta ao rascunho; conflito (`version-conflict`) e exclusão remota (`deleted`) pedem uma decisão e voltam à fila como transação nova.

**Registro de rascunho**

| Campo | Para que serve |
| --- | --- |
| `id` | UUID v7 gerado no cliente |
| `entity`, `entityId` | Qual agregado o rascunho cria ou edita |
| `data` | Valores do formulário, no formato do schema da UI |
| `step` | Etapa atual do stepper (o ambiente aberto na tela de campo) |
| `baseVersion` | Versão do servidor quando a edição começou; nula em criação |
| `status` | `draft`, `pending`, `conflict`, `rejected` |
| `errors` | Erros por campo vindos de `validation` |
| `conflict` | `current` do servidor e a lista de campos em disputa |
| `updatedAt` | Para o `DraftResume` |

**Regras**

- O formulário (react-hook-form) é hidratado do rascunho com `reset`; cada mudança, lida com `useWatch`, persiste com debounce curto. Nunca `watch()` no render (React Compiler).
- Um passo do stepper por ambiente. Validação em duas camadas: `roomStepSchema` para avançar de ambiente, `completeInspectionSchema` para concluir.
- Ambientes e itens têm `Id` UUID v7 do cliente. O que é removido no formulário é simplesmente omitido no `PUT`; o .NET marca como excluído.
- Na saída, `referenceCondition` e `referenceNotes` aparecem ao lado de cada item, somente leitura.
- Formulário sem mudança não gera transação: só um formulário sujo (`formState.isDirty`) vai para a fila. Todo `PUT` aceito sobe a versão, mesmo com os valores iguais ([ADR 0028](../decisions/0028-id-do-registro-so-na-rota-e-put-sempre-regrava.md)), então um envio sem mudança criaria uma versão nova e uma entrada no delta dos outros aparelhos.
- O Zod gerado traz o que o OpenAPI expressa (obrigatório, tamanhos, e-mail), mas não os dígitos verificadores de CPF/CNPJ. O schema da UI soma um `refine` com o mesmo cálculo do `CpfCnpjAttribute` do .NET (CPF com 11 dígitos; CNPJ com 14, alfanumérico nas 12 primeiras posições), com o valor sem máscara e `null` quando vazio. O .NET confere de novo, e o 400 em `errors.document` continua sendo tratado como qualquer erro por campo.
- As chaves de `errors` vêm no caminho do backend (`rooms[2].items[4].condition`) e passam pela conversão para o nome de campo do formulário antes do `setError`. A UI abre o ambiente onde está o primeiro erro.
- "Cancelar envio" só existe enquanto a transação nunca foi tentada. Depois da primeira tentativa ela pode ter sido aplicada, então o caminho é editar de novo.
- Rascunhos não expiram sozinhos. O `DraftResume` oferece continuar ou descartar. O rascunho do formulário profundo (com `step`) fica como `draft` até concluir ou descartar, porque guarda o ambiente aberto: o 2xx e um novo envio só tiram dele a recusa ou o conflito, e recusa e conflito mantêm os valores e o passo mais novos ([ADR 0036](../decisions/0036-rascunho-da-vistoria-guarda-o-passo-e-fica-ate-concluir.md)). Rascunho sem `step` (cliente, imóvel) é apagado quando sincroniza.

## Estrutura de pastas

O fluxo models → schemas → services → hooks → components → page continua igual. Services falam com o banco local e com o sync, nunca direto com a tela. O que é transversal ao sync fica em `shared/`.

```
src/
  app/                               # Next: só rotas e layouts, todos client
    (app)/inspections/page.tsx       # lista
    (app)/inspections/new/page.tsx
    (app)/inspections/edit/page.tsx  # ?id=  (sem segmento dinâmico)
    (app)/inspections/report/page.tsx
    (app)/inspections/conflict/page.tsx
    (app)/clients/...  (app)/properties/...  (app)/templates/...
    login/page.tsx
  features/
    inspections/
      models/                        # re-exporta tipos gerados + InspectionRecord local
      schemas/                       # roomStepSchema, completeInspectionSchema
      services/
        inspections.collection.ts    # collection TanStack DB + persistência
        inspections.sync.ts          # pull por delta + mutationFns da outbox
        inspections.merge.ts         # merge de três vias por campo, ambiente e item
        inspections.factory.ts       # nova a partir de roteiro; saída a partir de entrada
        inspections.mappers.ts       # DTO ↔ registro local
      hooks/
        useInspections.ts            # useLiveQuery sobre a collection
        useInspectionDraft.ts        # ciclo de vida do rascunho
      components/                    # compõem Sanjou UI, sem acesso a dados
    clients/  properties/  templates/  # mesma estrutura, mais simples
    local-store/                     # banco local do usuário: as collections e a outbox única (ADR 0034)
  shared/
    api/generated/                   # saída do gerador OpenAPI (não editar)
    api/client.ts                    # fetch com token e credentials
    api/problems.ts                  # handleProblem: switch exaustivo por ProblemType
    db/                              # persistência por usuário, versão de schema, wipe
    sync/outbox.ts                   # chaves, If-Match, ordem, backoff, compactação
    sync/merge.ts                    # escrita própria e merge de três vias por campo
    sync/scheduler.ts                # gatilhos de pull e status de rede
    auth/session.ts                  # access token em memória, janela offline
    auth/refreshLock.ts              # Web Locks + BroadcastChannel
    components/                      # shell, sync e o que falta no Sanjou (ADR 0020)
  sw.ts                              # service worker (Serwist)
```

| Camada | Pode importar | Nunca importa |
| --- | --- | --- |
| page | hooks, components | services, `api/` |
| components | Sanjou UI, outros components | hooks de dados, services |
| hooks | services, schemas | `api/generated` direto |
| services | models, schemas, `shared/*` | React |

As regras da tabela viram regras de lint (fronteiras de import), não convenção.

## Shell Next, PWA e rotas

O app inteiro é um bundle estático que o service worker pré-cacheia. Depois da primeira visita, abrir o app não depende de rede: o shell vem do cache e os dados vêm do banco local.

- **Static export.** `output: 'export'`. O static export não aceita segmentos dinâmicos sem `generateStaticParams`, e os IDs só existem em runtime. Por isso nenhuma rota tem `[id]`: o id vai na query string (`/inspections/edit?id=...`), lido com `useSearchParams` dentro de um `Suspense`. As rotas estão em [Telas](../vision.md#telas-e-fluxo-principal), no documento [Visão do Projeto](../vision.md).
- **Service worker (Serwist).** Pré-cache do static export inteiro: HTML, payloads RSC, chunks, fontes e ícones. A rota com `?id=` cai no HTML pré-cacheado da rota sem a query. Requisições à API nunca passam pelo cache do SW: quem cuida de dado é a camada de sync.
- **Build.** `next build` (Turbopack) e depois `serwist build`, que empacota o `src/sw.ts` e pré-cacheia o `out/` ([ADR 0032](../decisions/0032-serwist-pelo-cli-sobre-o-static-export-build-com-turbopack.md)). Em dev o SW não é registrado.
- **Atualização do app.** A versão nova do SW fica em espera; a UI mostra "Nova versão disponível" e só ativa com a outbox vazia.
- **Schema local.** Como a atualização só ativa com a outbox vazia, nunca há escrita pendente para migrar. Mudança incompatível no schema local faz wipe-and-resync (rascunhos `draft` são preservados e convertidos pelo mapper da versão).
- **Laudo.** `/inspections/report` é uma página com CSS `@media print`; o PDF sai do "Salvar como PDF" do navegador, inclusive offline.
- **Hospedagem.** Em produção, arquivos servidos pelo Caddy na mesma origem da API; em dev, `next dev` na porta 3000 (detalhes em [Ambientes](backend.md#ambientes-e-hospedagem), no documento do backend).
- **Instalável.** Manifest + ícones; abre em janela própria no desktop e no Android.

O que o static export proíbe e é aceito como custo: Server Components com dados, Server Actions, middleware, rotas de API, ISR, segmentos dinâmicos e otimização de imagem do `next/image` em runtime.

## Segurança

Sem servidor Next em produção, as CVEs de React Server Components não se aplicam. Sobram três riscos: sessão (inclusive offline e com várias abas), dados guardados no aparelho e supply chain.

**Sessão**

- Access token só em memória. Refresh token em cookie `HttpOnly` emitido pelo .NET, que o JavaScript nunca lê.
- **Refresh em uma aba só.** `navigator.locks.request('auth-refresh', ...)`: a aba que obtém o lock chama `refreshToken` e distribui o access token novo por `BroadcastChannel`; as outras esperam e reaproveitam. A tolerância de rotação do .NET cobre a corrida que sobrar.
- **Offline:** o app funciona dentro da janela de uso offline (Parâmetros). Passado esse prazo, a UI trava em "Reconecte para continuar", sem apagar nada.
- **Ao voltar a rede:** refresh primeiro, depois a outbox.
- **Refresh recusado (401):** sessão expirada. A tela de login aparece e a outbox fica retida. Login do mesmo usuário (mesmo `user.id`) retoma a fila. Login de outro usuário mostra que as pendências do anterior serão perdidas; confirmado, apaga o banco local do anterior.
- A autorização de cada escrita é refeita no .NET na hora do sync, não na hora em que o usuário digitou.

**Dados no aparelho**

- Banco local separado por `user.id`.
- Logout (`signOut`) apaga dados, outbox e caches, com aviso quando há pendências.
- Só existe no aparelho o que tem endpoint de sync. Entidades sensíveis simplesmente não têm sync (decisão registrada no [backend](backend.md#decisões-tomadas)), então o front não precisa classificar nada.

**Supply chain (vale para o app e para o Sanjou UI)**

- `minimumReleaseAge` no pnpm (7 dias), lockfile commitado e `--frozen-lockfile` no CI. O escopo `@sanjou/*` fica fora da janela, com versão fixada ([ADR 0022](../decisions/0022-sanjou-fora-do-minimum-release-age.md)).
- Sanjou UI publicado via trusted publishing (OIDC) com provenance; nenhum workflow com `pull_request_target` que faça checkout de código de fork.
- Workflows do GitHub Actions auditados com zizmor no CI.
- CSP restritiva no shell: `connect-src 'self'` em produção (mesma origem); em dev, também `http://localhost:8080`.

## UX de sincronização e Sanjou UI

A ousadia visual é tornar o sync legível sem torná-lo barulhento. O estado aparece onde o dado aparece, e só alerta quando o usuário precisa agir. Cada componente corresponde a um grupo da tabela de reações.

| Componente | Onde aparece | Responsabilidade |
| --- | --- | --- |
| `SyncStatus` | Header global | Online/offline, nº de pendências, último sync; abre o `OutboxPanel` |
| `SyncBadge` | Linha de lista, cabeçalho de registro | Local, enviando, sincronizado, conflito, rejeitado |
| `FieldSyncIndicator` | Ao lado do label | Campo alterado localmente e ainda não confirmado |
| `OutboxPanel` | Drawer lateral | Pendências, com as "travadas" em destaque; cancelar só o que nunca foi tentado |
| `ConflictResolver` | Tela dedicada | Diff por campo e por item ("meu", "servidor"); também trata "excluído em outro aparelho" |
| `OfflineBanner` | Topo do conteúdo | Aviso discreto; vira bloqueio só quando a janela offline vence |
| `SessionExpired` | Tela cheia | Login de novo, preservando a outbox |
| `DraftResume` | Entrada de formulário | "Você tem um rascunho de 14/10 — continuar ou descartar?" |
| `StepperForm` | Formulários profundos | Etapas com estado de validação e de sync por etapa |

**Diretrizes**

- Silêncio no caminho feliz: sincronizado não ganha ícone em toda linha.
- Cor nunca carrega significado sozinha: todo estado tem ícone e texto.
- Animação só em transição de estado, curta e desligada por `prefers-reduced-motion`.
- Movimento desenhado no Figma antes do código; carregamento do banco local com o `Skeleton` do Sanjou; avisos passageiros num toast (`Toaster` do Sanjou, no shell). Sem TanStack Query e sem push na V1 ([ADR 0033](../decisions/0033-movimento-carregamento-e-avisos-na-ui.md)).
- Keyboard-first: command palette e atalhos para salvar etapa, abrir pendências e alternar registros.

Os componentes ficam no app, em `shared/components/` ([ADR 0020](../decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)). Recebem um `SyncState` genérico e não conhecem TanStack DB, então podem ir para o Sanjou UI se outro projeto precisar deles.

**Fonte do design.** As telas são desenhadas no Figma, num arquivo do app que usa a biblioteca publicada do Sanjou UI, e implementadas a partir do link da seleção pelo MCP do Figma no Claude Code. A tela de campo e os componentes de sync acima são desenhados no marco MD, antes de qualquer tela em código. O fluxo completo está em ["Das telas no Figma para o código"](../vision.md#das-telas-no-figma-para-o-código), no documento [Visão do Projeto](../vision.md); o mapa de cada componente do Figma para o import está em [Figma → Sanjou](figma-sanjou.md).

## Riscos e spikes

Quatro spikes validam as apostas antes das telas; o primeiro foi dividido em 1a (aparelho) e 1b (servidor). As decisões de produto e arquitetura estão fechadas na tabela [Decisões tomadas](backend.md#decisões-tomadas) do documento do backend; nenhuma fica em aberto aqui.

**Riscos**

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| TanStack DB mudar API antes da 1.0 | Retrabalho em `services` | Hooks e telas não importam TanStack DB direto. Plano B: TanStack Query com cache persistido e outbox própria em `shared/sync`; o contrato não muda |
| Conflitos frequentes em formulários longos | Usuário perde confiança | Merge automático por campo e por item; diff só no que colidiu |
| Volume de dados local | App lento, quota do navegador | Escopo por dono; medido no spike 2 |
| Sanjou UI depender de recurso de servidor do Next | Quebra no static export | Verificado cedo no marco MD (página de prova no static export) e confirmado no spike 4 |

**Spikes** (as fases do backend de que cada um depende estão no [Roteiro de estudo](backend.md#roteiro-de-estudo) de lá)

- [x] **Spike 1a — Outbox no aparelho:** collection de clients persistida; escrita offline, reload, volta da rede, envio com `Idempotency-Key` pelo `upsertClient`; reenvio depois de derrubar a resposta com a mesma chave. Resultado: TanStack DB mantido, com os contornos do [ADR 0030](../decisions/0030-tanstack-db-mantido-apos-o-spike-1a-outbox-persistida-contra-o-upsertclient.md); roteiro em `pnpm spike:outbox`.
- [x] **Spike 1b — Outbox no servidor:** `If-Match`, 412/409 `version-conflict`, 428 e idempotência aplicada pelo .NET, com clientes e imóveis; o mesmo registro chega uma vez só ([ADR 0031](../decisions/0031-fatia-de-cadastro-antes-da-vistoria-no-m2.md)). Resultado: no celular, cliente e imóvel criados offline chegam ao SQL Server com um 201 por chave e a `version` do 201, e aparecem em `/clients` e `/properties`. Com a resposta derrubada, o reenvio recebe a resposta gravada, sem subir a versão, inclusive numa edição cujo `If-Match` já venceu. Duas edições seguidas saem em ordem, a segunda com a `version` da primeira. O 412 vira rascunho `conflict` com o `current` e sai da fila sem laço. Uma falha com `Retry-After` espera por ele dentro da `mutationFn` antes de voltar à fila (o executor só conhece o próprio backoff, que soma depois). Roteiro em `pnpm spike:outbox`.
- [ ] **Spike 2 — Volume:** 10 mil vistorias (com ambientes e itens) via delta paginado; medir abertura do app e tempo de live query.
- [ ] **Spike 3 — Conflito:** o segundo navegador recebe a vistoria pelo `GET` por id; os dois a editam offline, inclusive o mesmo item; 412/409 `version-conflict` com `current`; merge automático, diff e reenvio com chave nova. O mesmo vale para cliente e imóvel, com o merge plano. Exclusão de vistoria em andamento: `deleted` num `PUT` ("excluído em outro aparelho") e 412 num `DELETE` ("exclusão alterada"). `locked` fica para o M5, com concluir ([ADR 0038](../decisions/0038-escopo-do-m3-leitura-por-id-conflito-de-cadastro-e-exclusao.md)).
- [x] **Spike 4 — Shell:** static export + Serwist + Sanjou UI + rota `?id=`; abrir em modo avião depois da primeira visita (M2). Resultado: o shell e `/clients/edit?id=` abrem offline, servidos pelo SW, com o Serwist pelo CLI ([ADR 0032](../decisions/0032-serwist-pelo-cli-sobre-o-static-export-build-com-turbopack.md)); roteiro em `pnpm spike:shell`, no CI. Fica para o M4: duas abas renovando a sessão ao mesmo tempo, que depende do refresh.

Os spikes estão encaixados nos [marcos](../vision.md#marcos) do documento [Visão do Projeto](../vision.md): spike 1a antes do M2, spikes 1b e 4 na fatia de cadastro do M2 (o teste de duas abas do 4 no M4), spike 3 no M3, spike 2 no M4.
