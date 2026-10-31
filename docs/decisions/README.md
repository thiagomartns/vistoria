# Decisões (ADRs)

Um arquivo por decisão, com Contexto, Decisão e Consequências. Um ADR aceito nunca é editado:
uma decisão nova o substitui e diz qual substituiu. Novo ADR: `/adr <título>` a partir do [template](0000-template.md).

| # | Decisão | Status | Data |
| --- | --- | --- | --- |
| [0001](0001-dominio-vistoria-de-imoveis.md) | Domínio: vistoria de imóveis para locação | Aceito | 2026-10-16 |
| [0002](0002-fotos-fora-da-v1.md) | Fotos fora da V1 | Aceito | 2026-10-16 |
| [0003](0003-um-vistoriador-varios-aparelhos.md) | Um vistoriador, vários aparelhos | Aceito | 2026-10-16 |
| [0004](0004-signup-aberto-com-rate-limit.md) | Cadastro aberto com rate limit | Aceito | 2026-10-16 |
| [0005](0005-vistoria-concluida-imutavel.md) | Vistoria concluída é imutável | Aceito | 2026-10-16 |
| [0006](0006-laudo-pagina-imprimivel.md) | Laudo como página imprimível | Aceito | 2026-10-16 |
| [0007](0007-busca-so-no-banco-local.md) | Busca e listagem só no banco local | Aceito | 2026-10-16 |
| [0008](0008-exclusao-soft-delete-com-tombstones.md) | Exclusão só de vistoria em andamento, com tombstones | Aceito | 2026-10-16 |
| [0009](0009-banco-sql-server.md) | Banco: SQL Server | Aceito | 2026-10-16 |
| [0010](0010-front-em-static-export.md) | Front em static export | Aceito | 2026-10-16 |
| [0011](0011-hospedagem-docker-compose-mesma-origem.md) | Hospedagem: docker-compose na mesma origem | Aceito | 2026-10-16 |
| [0012](0012-sem-sync-engine-dedicado.md) | Sem sync engine dedicado | Aceito | 2026-10-16 |
| [0013](0013-entidades-sensiveis-sem-sync.md) | Entidades sensíveis não sincronizam | Aceito | 2026-10-16 |
| [0014](0014-monorepo.md) | Monorepo | Aceito | 2026-10-16 |
| [0015](0015-controllers-em-camadas.md) | Controllers em camadas, não vertical slices | Aceito | 2026-10-16 |
| [0016](0016-local-first-tanstack-db-outbox.md) | Local-first com TanStack DB e outbox | Aceito | 2026-10-16 |
| [0017](0017-contrato-via-openapi-commitado.md) | Contrato via openapi.json commitado | Aceito | 2026-10-16 |
| [0018](0018-erros-pelo-type.md) | Erros decididos pelo type, nunca pelo status | Aceito | 2026-10-16 |
| [0019](0019-login-da-v1-com-o-pattern-auth-do-sanjou.md) | Login da V1 com o pattern Auth do Sanjou | Aceito | 2026-10-16 |
| [0020](0020-componentes-que-faltam-no-sanjou-ficam-no-app.md) | Componentes que faltam no Sanjou ficam no app | Aceito | 2026-10-16 |
| [0021](0021-formulario-editavel-com-transacao-na-fila.md) | Formulário editável com transação na fila | Aceito | 2026-10-19 |
| [0022](0022-sanjou-fora-do-minimum-release-age.md) | Sanjou fora do minimumReleaseAge | Aceito | 2026-10-19 |
| [0023](0023-formularios-com-react-hook-form.md) | Formulários com react-hook-form para usar o Form do Sanjou | Aceito | 2026-10-19 |
| [0024](0024-type-de-erro-como-urn.md) | type de erro como URN | Aceito | 2026-10-20 |
| [0025](0025-senha-local-gerada-nunca-de-exemplo.md) | Senha local gerada, nunca de exemplo | Aceito | 2026-10-20 |
| [0026](0026-usuario-e-entidades-de-autenticacao-fora-do-syncentity-senha-de-8-a-128-caracteres-sem-regra-de-composicao.md) | Usuário e entidades de autenticação fora do SyncEntity; senha de 8 a 128 caracteres sem regra de composição | Aceito | 2026-10-20 |
| [0027](0027-credencial-invalida-com-type-proprio-invalid-credentials-complementando-o-adr-0018.md) | Credencial inválida com type próprio (invalid-credentials), complementando o ADR 0018 | Aceito | 2026-10-20 |
| [0028](0028-id-do-registro-so-na-rota-e-put-sempre-regrava.md) | Id do registro só na rota, e PUT sempre regrava | Aceito | 2026-10-21 |
| [0029](0029-marca-avis-nome-exibido-e-simbolo-d1.md) | Marca Avis: nome exibido e símbolo D1 | Aceito | 2026-10-21 |
| [0030](0030-tanstack-db-mantido-apos-o-spike-1a-outbox-persistida-contra-o-upsertclient.md) | TanStack DB mantido após o spike 1a (outbox persistida contra o upsertClient) | Aceito | 2026-10-21 |
| [0031](0031-fatia-de-cadastro-antes-da-vistoria-no-m2.md) | Fatia de cadastro antes da vistoria no M2 | Aceito | 2026-10-22 |
| [0032](0032-serwist-pelo-cli-sobre-o-static-export-build-com-turbopack.md) | Serwist pelo CLI sobre o static export, build com Turbopack | Aceito | 2026-10-22 |
| [0033](0033-movimento-carregamento-e-avisos-na-ui.md) | Movimento, carregamento e avisos na UI | Aceito | 2026-10-22 |
| [0034](0034-outbox-serial-uma-transacao-por-vez-na-ordem-de-criacao.md) | Outbox serial: uma transação por vez, na ordem de criação | Aceito | 2026-10-22 |
| [0035](0035-ambiente-e-item-do-agregado-sobre-aggregatechild-sem-syncentity.md) | Ambiente e item do agregado sobre AggregateChild, sem SyncEntity | Aceito | 2026-10-23 |
| [0036](0036-rascunho-da-vistoria-guarda-o-passo-e-fica-ate-concluir.md) | Rascunho da vistoria guarda o passo e fica até concluir | Aceito | 2026-10-26 |
| [0037](0037-entregaveis-pelo-vision-md-e-pelo-milestone-sem-project.md) | Entregáveis pelo vision.md e pelo milestone, sem Project | Aceito | 2026-10-26 |
| [0038](0038-escopo-do-m3-leitura-por-id-conflito-de-cadastro-e-exclusao.md) | Escopo do M3: leitura por id, conflito de cadastro e exclusão | Proposto | 2026-10-27 |
| [0039](0039-exclusao-de-vistoria-pela-outbox-marca-otimista-compactacao-por-exclusao-e-delete-decidido-no-envio.md) | Exclusão de vistoria pela outbox: marca otimista, compactação por exclusão e DELETE decidido no envio | Proposto | 2026-10-28 |
| [0040](0040-conflitos-da-exclusao-tipo-no-rascunho-current-adotado-no-412-e-recriar-com-ids-novos.md) | Conflitos da exclusão: tipo no rascunho, current adotado no 412 e recriar com ids novos | Proposto | 2026-10-28 |
| [0041](0041-o-pull-nao-toca-registro-com-pendencia.md) | O pull não toca registro com pendência | Proposto | 2026-10-29 |
| [0042](0042-pull-grava-a-pagina-antes-do-cursor-e-reaplica-sem-efeito.md) | Pull grava a página antes do cursor e reaplica sem efeito | Proposto | 2026-10-29 |
| [0043](0043-rascunho-limpo-nao-segura-o-pull-e-o-resync-varre-no-fim.md) | Rascunho limpo não segura o pull, e o resync varre no fim | Proposto | 2026-10-29 |
| [0044](0044-o-pull-nao-aplica-resposta-mais-velha-que-o-aparelho-e-a-fila-conta-como-pendencia.md) | O pull não aplica resposta mais velha que o aparelho, e a fila conta como pendência | Proposto | 2026-10-30 |
| [0045](0045-o-unauthorized-se-renova-no-client-que-reenvia-a-mesma-requisicao-refresh-sem-resposta-nao-expira-a-sessao-token-renovado-de-outro-usuario-nao-vale.md) | O unauthorized se renova no client, que reenvia a mesma requisição; refresh sem resposta não expira a sessão; token renovado de outro usuário não vale | Proposto | 2026-10-31 |
