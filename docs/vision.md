# Visão do Projeto — App local-first

Ponto de entrada do projeto. A arquitetura detalhada está em [Arquitetura Frontend](architecture/frontend.md) e [Arquitetura Backend](architecture/backend.md); este documento diz o que construir, em que ordem e como trabalhar.

## Produto

Um app de **vistoria de imóveis para locação** usado por vistoriadores autônomos. A promessa central: **nenhum registro feito em campo se perde, e todo registro tem autoria e data verificáveis.** É a parte que o mercado ainda resolve mal (sincronização em rede ruim e laudo usado como prova), e é exatamente o que a arquitetura desenhada resolve.

**Para quem.** Vistoriador autônomo (tipicamente MEI) que presta serviço para algumas imobiliárias e faz várias vistorias por dia. Em campo usa o celular, muitas vezes em subsolo, garagem ou imóvel vazio com internet cortada. À noite revisa e emite os laudos no notebook. É um usuário com dois aparelhos, sem equipe.

**Codinome do projeto:** `vistoria`. **Nome exibido:** Avis ([ADR 0029](decisions/0029-marca-avis-nome-exibido-e-simbolo-d1.md)).

### Histórias da versão 1

| # | Como vistoriador, eu... | Para... |
| --- | --- | --- |
| H1 | Entro com e-mail e senha e continuo usando o app offline | Trabalhar o dia inteiro sem depender de sinal |
| H2 | Cadastro clientes (imobiliárias) e seus imóveis | Saber para quem e onde é cada vistoria |
| H3 | Mantenho roteiros: listas de ambientes e itens reaproveitáveis | Não montar a mesma estrutura toda vez |
| H4 | Crio uma vistoria de entrada a partir de um roteiro | Começar com a estrutura pronta |
| H5 | Crio a vistoria de saída a partir da entrada concluída, vendo o estado anterior de cada item | Comparar e separar desgaste natural de dano |
| H6 | Percorro o imóvel ambiente por ambiente, adicionando, removendo e reordenando itens, com condição e observação | Registrar tudo, inclusive o que o roteiro não previa |
| H7 | Fecho o app no meio e retomo exatamente de onde parei | Nunca perder trabalho |
| H8 | Termino no celular e reviso no notebook; as edições dos dois convergem | Revisar com calma sem medo de sobrescrever |
| H9 | Concluo a vistoria, que fica travada, e imprimo o laudo (PDF pelo navegador) | Entregar um documento que vale como prova |
| H10 | Busco vistorias por cliente, imóvel, tipo, status e data | Achar qualquer vistoria em segundos |
| H11 | Vejo o que falta sincronizar e resolvo conflitos | Confiar no que está no servidor |

### Fora da versão 1

| Tema | Quando |
| --- | --- |
| Fotos por item | Versão 2 (o modelo já reserva o lugar delas) |
| Assinatura das partes | Versão 3 |
| IA para redigir observações | Sem previsão |
| Equipes, vários vistoriadores, portal da imobiliária | Sem previsão |
| Envio do laudo por e-mail ou WhatsApp | Sem previsão |
| Agenda, cobrança, contestação | Sem previsão |
| App nativo | Não: o PWA cobre |

### Decisões de produto

- **Vistoria concluída é imutável.** Correção depois de concluir é tema de versão futura (adendo). É o que dá valor de prova ao laudo.
- **Laudo é uma página imprimível do front**, convertida em PDF pelo próprio navegador. Funciona offline e não exige geração de PDF no servidor.
- **Cliente e imóvel não são excluídos na V1**, só editados. Evita regras de exclusão em cascata sobre vistorias que são prova.
- **A saída copia o estado da entrada** no momento da criação. O comparativo funciona offline sem precisar ler outra vistoria.

## Modelo de domínio

Quatro entidades sincronizáveis (`Client`, `Property`, `Template`, `Inspection`), todas herdando de `SyncEntity`. A vistoria é o agregado central: vistoria → ambientes → itens, escrita inteira num `PUT` e versionada só na raiz.

> Diagrama: entidades da V1 · 4 sincronizáveis, 1 agregado de 3 níveis (disponível na versão original do documento)

Room e Item não têm versão própria; mudar qualquer item sobe a versão da vistoria. O roteiro é só um molde: depois de copiado, a vistoria não depende mais dele.

### Inspection (raiz)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | Guid | UUID v7 do cliente |
| `propertyId` | Guid | Obrigatório |
| `kind` | `moveIn` \| `moveOut` | Entrada ou saída |
| `status` | `inProgress` \| `completed` | Concluída é imutável |
| `referenceInspectionId` | Guid? | Só em saída: uma entrada concluída do mesmo imóvel |
| `startedAt` | data e hora | Definido na criação |
| `completedAt` | data e hora? | Definido pelo servidor ao concluir |
| `generalNotes` | texto | Até 2.000 caracteres |
| `rooms` | Room\[\] | Até 40 |
| `version` | base64 | Do servidor |

### Room e Item

| Entidade | Campo | Tipo | Regra |
| --- | --- | --- | --- |
| Room | `id` | Guid | UUID v7 do cliente |
| Room | `name` | texto | 1 a 60 caracteres ("Cozinha", "Suíte 1") |
| Room | `position` | inteiro | Ordem na vistoria |
| Room | `notes` | texto | Até 1.000 caracteres |
| Room | `items` | Item\[\] | Até 60 |
| Item | `id` | Guid | UUID v7 do cliente |
| Item | `name` | texto | 1 a 60 caracteres ("Piso", "Tomadas") |
| Item | `position` | inteiro | Ordem no ambiente |
| Item | `condition` | `new` \| `good` \| `fair` \| `poor` \| `absent` \| nulo | Nulo até ser avaliado |
| Item | `notes` | texto | Até 1.000 caracteres |
| Item | `referenceCondition`, `referenceNotes` | cópia | Só em saída; copiados da entrada, somente leitura |

### Client, Property e Template

| Entidade | Campos | Regras |
| --- | --- | --- |
| Client | `name`, `document`, `email`, `phone` | Nome de 2 a 120 caracteres; CPF ou CNPJ opcional, sem máscara e com os dígitos verificadores (CNPJ também alfanumérico, como a Receita emite desde julho de 2026) |
| Property | `clientId`, `street`, `number`, `complement`, `district`, `city`, `state`, `zipCode`, `type`, `notes` | UF com 2 letras; CEP com 8 dígitos; `type`: `apartment` \| `house` \| `commercial` \| `other` |
| Template | `name`, `rooms[{ id, name, position, items[{ id, name, position }] }]` | Mesmos limites de Room e Item; um roteiro padrão "Apartamento" vem no seed |

### Regras de negócio

- **Concluir** exige ao menos um ambiente, ao menos um item por ambiente e `condition` preenchida em todos os itens. O erro aponta o caminho exato: `rooms[2].items[4].condition`.
- **Concluída é imutável.** `PUT` ou `DELETE` numa vistoria concluída responde 409 `locked` (tipo novo no [catálogo do backend](architecture/backend.md#catálogo-de-erros)).
- **Saída a partir da entrada** é feita no front: copia ambientes e itens com Ids novos, preenche `referenceCondition` e `referenceNotes` e deixa `condition` nula.
- **Exclusão:** só vistoria em andamento (soft delete). Cliente, imóvel e roteiro não são excluídos na V1.
- **Escopo:** tudo pertence a um `OwnerId`; um vistoriador nunca vê dado de outro.

## Telas e fluxo principal

O fluxo que importa: **lista → nova vistoria → ambiente por ambiente → concluir → laudo**. O resto são cadastros de apoio. Rotas sem segmento dinâmico: o id vai na query string, por causa do static export.

| Tela | Rota | Histórias | O que faz |
| --- | --- | --- | --- |
| Login | `/login` | H1 | E-mail e senha, pelo pattern Auth do Sanjou sem "Lembrar-me" ([ADR 0019](decisions/0019-login-da-v1-com-o-pattern-auth-do-sanjou.md)); também é a tela de sessão expirada |
| Criar conta | `/signup` | H1 | Nome, e-mail e senha; entra direto, sem verificação de e-mail na V1 |
| Vistorias | `/inspections` | H10, H11 | Lista com busca e filtros locais; `SyncBadge` por linha; `SyncStatus` no header |
| Nova vistoria | `/inspections/new` | H4, H5 | Escolhe imóvel e tipo; entrada parte de um roteiro, saída parte de uma entrada concluída |
| Vistoria em campo | `/inspections/edit?id=` | H6, H7, H8 | O formulário profundo: um passo por ambiente, itens com condição em um toque e observação; na saída, o estado de entrada ao lado |
| Laudo | `/inspections/report?id=` | H9 | Página de impressão (CSS `@media print`); só para vistoria concluída |
| Conflito | `/inspections/conflict?id=` | H8, H11 | `ConflictResolver`: diff por ambiente e item |
| Clientes | `/clients`, `/clients/edit?id=` | H2 | Cadastro simples |
| Imóveis | `/properties`, `/properties/edit?id=` | H2 | Cadastro com endereço; lista as vistorias do imóvel |
| Roteiros | `/templates`, `/templates/edit?id=` | H3 | Editor de ambientes e itens (arrastar para ordenar) |

**Design antes do código.** Toda tela é desenhada primeiro no Figma, num arquivo do app que usa a biblioteca publicada do Sanjou UI (tokens validados contra o código na versão 0.2.0). A implementação parte do link da seleção, lido pelo MCP do Figma no Claude Code (ver "Das telas no Figma para o código"). A tela "Vistoria em campo" é a única que exige alta fidelidade antes de codar: é usada com uma mão, em pé, às vezes com pouca luz, então pede alvos de toque grandes, condição em chips (novo, bom, regular, ruim, ausente) e navegação entre ambientes sem rolar. As demais podem partir de wireframes, porque são composições diretas de componentes. Quem desenha é o Claude Code, pelo MCP do Figma, com componentes, variáveis e estilos do Sanjou; você revisa como dono do produto (o fluxo faz sentido para quem está no imóvel? dá para usar com um polegar?) e testa a tela de campo no app do Figma no celular. O marco MD organiza esse trabalho.

## Marcos

Um roteiro único junta as fases do backend, os spikes do front e a fase de design. Cada marco termina numa entrega que você consegue **ver funcionando**, não numa lista de tarefas feitas. No ritmo de 5 h por semana, são 25 semanas de trabalho (cerca de 125 horas) e uma de pausa no fim do ano.

> Diagrama: roteiro da V1 · 7 marcos, início em 19 out 2026 (disponível na versão original do documento)

O M2 é o mais longo e o mais arriscado: é onde backend e front se encontram pela primeira vez offline.

| Marco | Entrega verificável | Backend (fases) | Front |
| --- | --- | --- | --- |
| M0 · Fundação | Repositório com CI verde, docs em `docs/`, `CLAUDE.md`, banco sobe com um comando, backlog do M1 pronto | — | Esqueleto Next com static export |
| MD · Design | Arquivo do app no Figma com fluxos, shell, tela de campo em alta fidelidade (celular e desktop, todos os estados de sync) e demais telas em wireframe; Sanjou UI renderizando no static export | — | Sanjou no shell; mapa Figma → Sanjou; comando `/screen` |
| M1 · Contrato e domínio | Swagger UI mostra as 4 entidades e o catálogo de erros; front gera tipos e `ProblemType` sem erro | 1 e 2 | `gen:api`, client, `handleProblem` |
| M2 · Escrita confiável | Criar vistoria offline, recarregar a página, voltar a rede: ela chega ao SQL Server uma vez só | 3, 4 e 5 | Shell e PWA (spike 4), outbox (spikes 1a e 1b), tela de campo básica a partir do Figma |
| M3 · Conflito | Dois navegadores editam a mesma vistoria offline e convergem sem perder nada | — | Merge e `ConflictResolver` (spike 3) |
| M4 · Leitura e sessão | Aparelho novo baixa tudo; 10 mil vistorias abrem rápido; duas abas renovam a sessão sem deslogar | 6 | Pull por delta, sessão offline, refresh em aba única (spike 2) |
| M5 · Produto V1 | Vistoria real de entrada e saída, ponta a ponta, com laudo impresso, rodando no docker-compose de produção | Ajustes | Todas as telas a partir do Figma, roteiros, saída a partir da entrada, concluir, laudo |

**Se atrasar.** As estimativas são otimistas. O MD tem prazo fechado de 3 semanas: o que não ficar pronto em alta fidelidade segue como wireframe e é refinado no M5. Se o M2 passar duas semanas do previsto, o corte vem do M5 (roteiros editáveis viram um roteiro fixo; filtros viram busca simples), nunca da arquitetura de sync, que é o objetivo do estudo.

### Backlog do M0

- [ ] Criar o repositório `vistoria` com a estrutura, o workspace pnpm e a solution .NET
- [ ] Exportar os três documentos para `docs/` e escrever os três `CLAUDE.md`
- [ ] Criar os ADRs iniciais a partir das [Decisões tomadas](architecture/backend.md#decisões-tomadas) do backend
- [ ] `docker-compose.dev.yml` com SQL Server e o comando `pnpm db:up`
- [ ] CI com os jobs `api` e `web` (esqueleto) e `security`
- [ ] GitHub Project, labels e modelo de issue
- [ ] Escrever as issues do M1

### Backlog do MD

- [ ] Criar o arquivo "vistoria — app" no time do Figma, com a biblioteca Sanjou UI ativada e as páginas Fluxos, Wireframes, Telas e Componentes novos
- [ ] Fluxos: login; lista → nova vistoria → campo → concluir → laudo; sessão expirada; conflito
- [ ] Shell: navegação, header com `SyncStatus`, `OfflineBanner`, comportamento no celular e no desktop
- [ ] Tela de campo em alta fidelidade, no celular e no desktop, com os estados vazio, offline, enviando, conflito, rejeitado e concluída
- [ ] Wireframes das demais telas da tabela de Telas
- [ ] Componentes que faltam no Sanjou (`SyncBadge`, `ConflictResolver` e os demais) desenhados como componentes locais no arquivo do app, com os genéricos marcados "Candidato ao Sanjou"
- [ ] Sanjou UI instalado em `apps/web`, com uma página de prova no static export (adianta a parte de risco do spike 4)
- [ ] Mapa "componente no Figma → import do Sanjou" em `apps/web/CLAUDE.md` e o comando `/screen` no repositório

## Repositório e ambiente

Um monorepo no GitHub, `vistoria`. O Claude Code enxerga front, API e documentação ao mesmo tempo, e uma mudança de contrato vai num commit só. O Sanjou UI continua no repositório dele e entra como pacote.

```
vistoria/
  apps/
    web/                      # Next.js, static export
    api/                      # Vistoria.Api/ + Vistoria.Api.Tests/
      openapi.json            # gerado no build da API, commitado
  docs/
    vision.md                 # este documento
    architecture/frontend.md
    architecture/backend.md
    decisions/                # ADRs: 0001-*.md, 0002-*.md...
  infra/
    docker-compose.dev.yml    # só o SQL Server
    docker-compose.prod.yml   # proxy (Caddy), api, db
    Caddyfile
  scripts/
    seed/                     # cria dados via API (usa o client gerado)
  .github/workflows/ci.yml
  .claude/commands/           # comandos do Claude Code
  CLAUDE.md
  package.json                # workspace pnpm (web + scripts)
```

**O contrato vira arquivo.** A API gera `openapi.json` no próprio build (`Microsoft.Extensions.ApiDescription.Server`), e o arquivo é commitado. O `pnpm gen:api` lê esse arquivo, então o front gera tipos sem precisar da API rodando, inclusive no CI. Uma mudança de DTO aparece como diff em `openapi.json` e no código gerado, no mesmo PR.

### Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm db:up` | Sobe o SQL Server em container |
| `pnpm dev:api` | `dotnet watch` em `localhost:8080`, com migrações automáticas em dev |
| `pnpm dev:web` | `next dev` em `localhost:3000` |
| `pnpm gen:api` | Gera tipos, client, Zod e `ProblemType` a partir de `openapi.json` |
| `pnpm check` | Lint, typecheck e testes do front |
| `pnpm test:api` | `dotnet test` (Testcontainers sobe o próprio banco) |
| `pnpm seed -- --inspections 200` | Cria usuário, clientes, imóveis, roteiro padrão e N vistorias pela API |

**Usuário de desenvolvimento:** `dev@vistoria.local`, criado pelo seed através do endpoint de cadastro (\`signUp\`), nunca por migração. O spike 2 usa `--inspections 10000`.

### CI (GitHub Actions)

| Job | Passos |
| --- | --- |
| `api` | `dotnet build` (regenera `openapi.json` e falha se diferir do commitado) e `dotnet test` |
| `web` | `pnpm install --frozen-lockfile`, `pnpm gen:api` (falha se o gerado diferir), `pnpm check` |
| `e2e` | A partir do M2: Playwright com rede cortada e duas abas |
| `security` | zizmor nos workflows |

### Branches

- `main` protegida: só entra por PR com CI verde.
- Uma branch por issue: `feat/42-outbox-retry`. Commits no padrão Conventional Commits.
- Squash merge. Mesmo sozinho, o PR é o momento em que você revisa o que o Claude Code fez.

## Trabalho com o Claude Code

O Claude Code começa cada sessão sem memória da anterior. Tudo o que ele precisa saber tem de estar no repositório, e cada sessão tem de caber numa tarefa com começo, meio e fim.

### Fonte da verdade

- No M0, os três documentos (este, front e backend) são exportados para Markdown em `docs/`. **A partir daí, o repositório manda.** Mudança de arquitetura entra por PR, junto com um ADR.
- As versões aqui no Claude ficam como leitura e discussão. Quando uma conversa aqui mudar uma decisão, o resultado vira PR no repositório.

### Arquivos `CLAUDE.md`

| Arquivo | Conteúdo |
| --- | --- |
| `CLAUDE.md` (raiz) | O produto em 5 linhas; mapa do repositório; os comandos; como trabalhar uma issue; a definição de pronto; links para `docs/` |
| `apps/web/CLAUDE.md` | Camadas e fronteiras de import; reação a erro só por `ProblemType`; nunca editar `generated/`; `If-Match` e `Idempotency-Key` só na outbox; usar componentes do Sanjou UI |
| `apps/api/CLAUDE.md` | Camadas do curso; `SyncEntity` em tudo; erro só por exceção tipada do catálogo; proibido `FromSqlRaw` com valor externo e `DateTime.Now`; todo endpoint com `[EndpointName]` |

Cada `CLAUDE.md` fica curto (uma tela) e aponta para `docs/` em vez de repetir o conteúdo.

### Backlog no GitHub

- **Project** com colunas Backlog, Próximo, Em andamento, Em revisão e Feito, mais o campo **Marco** (M0, MD e M1 a M5).
- **Labels:** `area:web`, `area:api`, `area:infra`, `area:docs`, `area:design` e `type:feat`, `type:fix`, `type:chore`, `type:spike`, `type:design` (as de design marcam o trabalho no Figma, feito pelo Claude Code via MCP e revisado por você; não geram PR, e o critério de aceite é o link do frame na issue).
- **Uma issue cabe em uma sessão** (1 a 2 h). Se não cabe, vira duas.

**Modelo de issue**

```
## Contexto
Link para a seção de docs/ que justifica a tarefa.

## Escopo
O que entra.

## Fora de escopo
O que não entra (evita que a sessão se espalhe).

## Critérios de aceite
- [ ] Comportamento verificável por teste
- [ ] ...

## Notas técnicas
Arquivos prováveis, armadilhas conhecidas.
```

### Fluxo de uma sessão

1. Você move uma issue para "Em andamento" e chama `/issue 42`.
2. O Claude Code lê a issue e as seções de `docs/` citadas e propõe um plano em modo de planejamento.
3. Você aprova ou corrige o plano. É o ponto de maior alavancagem: um plano errado custa minutos, código errado custa a sessão.
4. Ele implementa com testes, roda `pnpm check` e `pnpm test:api` e abre o PR ligado à issue.
5. Você revisa e faz o merge.

**Comandos do projeto** em `.claude/commands/`: `/issue <n>` (carrega a issue e os docs e propõe o plano), `/adr <título>` (cria um ADR no modelo), `/gen-api` (regenera o contrato e explica o diff) e, a partir do MD, `/screen <link> <issue>` (implementa uma tela a partir de um link do Figma).

### Das telas no Figma para o código

1. A tela está desenhada no arquivo do app no Figma ([vistoria — app](https://www.figma.com/design/BJDaQ12Mlx1YCdKwjETHmE/vistoria-%E2%80%94-app)), usando só componentes da biblioteca Sanjou UI, e foi aprovada por você.
2. Você copia o link da seleção do frame (Copy link to selection) e chama `/screen <link> <issue>`.
3. O Claude Code lê o frame pelo MCP do Figma e monta a tela **com os componentes do Sanjou**, nunca recriando com `div` e classes o que já existe no pacote. O mapa "componente no Figma → import do Sanjou" fica em `apps/web/CLAUDE.md`.
4. A tela é ligada aos hooks da feature (dado nunca entra direto no componente); ele roda os checks e abre o PR com prints da tela renderizada no celular e no desktop.
5. Componente que não existe no Sanjou não é improvisado na tela: é desenhado como componente local na página "Componentes novos" do Figma e implementado em `shared/components/`, só com primitivos e tokens do Sanjou ([ADR 0020](decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)).

### Definição de pronto

- [ ] Todos os critérios de aceite atendidos e cobertos por teste
- [ ] `pnpm check` e `pnpm test:api` verdes localmente e no CI
- [ ] Se a API mudou: `openapi.json` e o código gerado atualizados no mesmo PR
- [ ] Se uma decisão mudou: ADR novo em `docs/decisions/` e o doc afetado atualizado
- [ ] PR revisado por você

### ADRs

Um arquivo por decisão, `docs/decisions/NNNN-titulo.md`, com três seções: Contexto, Decisão e Consequências. Os primeiros saem da tabela [Decisões tomadas](architecture/backend.md#decisões-tomadas) do backend, no M0. Um ADR nunca é editado depois de aceito; uma decisão nova o substitui e diz qual substituiu.

**Componentes que faltam no Sanjou UI** (`SyncBadge`, `ConflictResolver`, navegação, Sheet e os demais) são feitos neste repositório, com primitivos e tokens do Sanjou; os genéricos são marcados "Candidato ao Sanjou" e sobem em bloco numa release futura ([ADR 0020](decisions/0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)).

## Glossário

Um termo, um significado, em todos os documentos, issues e prompts.

| Termo | Significado |
| --- | --- |
| Vistoria de entrada / saída | Registro do estado do imóvel no início / no fim da locação (`moveIn` / `moveOut`) |
| Ambiente | Cômodo ou área vistoriada (`Room`) |
| Item | Elemento avaliado dentro do ambiente: piso, tomada, janela (`Item`) |
| Condição | Avaliação do item: novo, bom, regular, ruim, ausente |
| Roteiro | Molde de ambientes e itens copiado ao criar uma vistoria (`Template`) |
| Laudo | A vistoria concluída em formato de documento para impressão |
| Agregado | Conjunto escrito e versionado como uma unidade; aqui, vistoria + ambientes + itens |
| Local-first | A UI lê e escreve no banco do aparelho; a rede só sincroniza |
| Outbox | Fila durável no aparelho com as escritas ainda não confirmadas pelo servidor |
| Delta | Leitura só do que mudou desde o último cursor |
| Cursor | Marcador opaco de até onde o aparelho já sincronizou |
| Tombstone | Registro excluído que continua existindo (com `DeletedAt`) para avisar os aparelhos |
| Versão / ETag | Identificador da versão do registro no servidor (rowversion), usado para detectar conflito |
| `If-Match` | Cabeçalho em que o cliente diz sobre qual versão está escrevendo |
| `Idempotency-Key` | Chave que faz um reenvio ter o mesmo efeito do envio original |
| `serverShadow` | Última versão do servidor que o aparelho viu; base do merge |
| Merge de três vias | Compara base, local e servidor; só vai para o usuário o que os dois lados mudaram |
| `ProblemType` | Lista fechada de tipos de erro do catálogo, gerada do contrato |
| Static export | Build do Next.js em arquivos estáticos, sem servidor |
| Marco (M0–M5 e MD) | Etapa do roteiro com uma entrega verificável |
| ADR | Registro curto de uma decisão de arquitetura |
