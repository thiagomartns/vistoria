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
| [0046](0046-troca-de-usuario-e-saida-o-token-novo-so-vira-sessao-depois-de-confirmar-a-limpeza-esvazia-a-outbox-antes-do-deletedatabase-e-a-janela-offline-sem-data-conta-como-vencida.md) | Troca de usuário e saída: o token novo só vira sessão depois de confirmar, a limpeza esvazia a outbox antes do deleteDatabase, e a janela offline sem data conta como vencida | Proposto | 2026-10-31 |
| [0047](0047-lista-de-vistorias-em-paginas-de-50-e-pull-lendo-a-store-por-chave-pela-ordem-do-rowversion-resultado-do-spike-2-134.md) | Lista de vistorias em páginas de 50 e pull lendo a store por chave pela ordem do rowversion (resultado do spike 2, #134) | Proposto | 2026-11-01 |
| [0048](0048-a-lista-de-vistorias-le-um-resumo-gravado-na-mesma-transacao-e-a-vistoria-completa-carrega-por-id.md) | A lista de vistorias lê um resumo gravado na mesma transação, e a vistoria completa carrega por id | Proposto | 2026-11-02 |
| [0049](0049-a-limpeza-apaga-a-vistoria-excluida-ha-mais-de-90-dias-com-os-filhos-e-os-filhos-excluidos-de-uma-vistoria-viva-ficam.md) | A limpeza apaga a vistoria excluída há mais de 90 dias com os filhos, e os filhos excluídos de uma vistoria viva ficam | Proposto | 2026-11-02 |
| [0050](0050-a-vistoria-local-guarda-o-completedat-do-servidor-fora-do-corpo-do-put-a-conclusao-encerra-o-rascunho-e-a-conclusao-recusada-volta-para-inprogress-179.md) | A vistoria local guarda o completedAt do servidor fora do corpo do PUT; a conclusão encerra o rascunho, e a conclusão recusada volta para inProgress (#179) | Proposto | 2026-11-09 |
| [0051](0051-kind-referencia-e-copias-da-saida-sao-da-criacao-o-put-de-atualizacao-os-ignora-169.md) | kind, referência e cópias da saída são da criação; o PUT de atualização os ignora (#169) | Proposto | 2026-11-10 |
| [0052](0052-a-saida-guarda-a-referencia-e-as-copias-no-registro-local-so-quando-existem-e-a-nova-vistoria-oferece-as-entradas-pelo-resumo-com-a-fila-por-cima-170.md) | A saída guarda a referência e as cópias no registro local só quando existem, e a Nova vistoria oferece as entradas pelo resumo com a fila por cima (#170) | Proposto | 2026-11-10 |
| [0053](0053-a-autoria-da-conclusao-e-gravada-pelo-servidor-com-o-nome-copiado-e-as-concluidas-de-antes-ganham-a-do-dono-183.md) | A autoria da conclusão é gravada pelo servidor com o nome copiado, e as concluídas de antes ganham a do dono (#183) | Proposto | 2026-11-10 |
| [0054](0054-o-laudo-so-abre-com-a-conclusao-confirmada-pelo-servidor-e-a-impressao-fica-no-css-do-navegador-168.md) | O laudo só abre com a conclusão confirmada pelo servidor, e a impressão fica no CSS do navegador (#168) | Proposto | 2026-11-10 |
| [0055](0055-a-aba-que-esperou-o-lock-do-refresh-espera-o-anuncio-da-outra-antes-de-renovar-190.md) | A aba que esperou o lock do refresh espera o anúncio da outra antes de renovar (#190) | Proposto | 2026-11-10 |
| [0056](0056-compose-de-producao-a-migracao-roda-num-servico-de-uma-vez-com-o-efbundle-da-imagem-da-api-e-a-api-so-confia-no-x-forwarded-for-do-proxy-por-ip-fixo-na-rede-do-compose-177.md) | Compose de produção: a migração roda num serviço de uma vez com o efbundle da imagem da API, e a API só confia no X-Forwarded-For do proxy, por IP fixo na rede do compose (#177) | Proposto | 2026-11-12 |
| [0057](0057-o-editor-de-roteiro-reordena-com-o-dnd-kit-pela-alca-e-pelo-teclado-e-o-conflito-de-roteiro-fica-no-merge-plano-com-os-ambientes-como-um-campo-so-173.md) | O editor de roteiro reordena com o dnd-kit, pela alça e pelo teclado, e o conflito de roteiro fica no merge plano com os ambientes como um campo só (#173) | Proposto | 2026-11-12 |
| [0058](0058-a-tela-de-campo-edita-a-estrutura-no-formulario-ids-em-roomid-itemid-position-do-indice-itens-num-modo-de-edicao-por-ambiente-e-ambientes-num-sheet-a-fila-espera-nomes-validos-o-recarregar-com-a-tela-aberta-vira-merge-de-tres-vias-171.md) | A tela de campo edita a estrutura no formulário (ids em roomId/itemId, position do índice); itens num modo de edição por ambiente e ambientes num Sheet; a fila espera nomes válidos; o recarregar com a tela aberta vira merge de três vias (#171) | Proposto | 2026-11-12 |
| [0059](0059-a-entrada-com-saida-se-descobre-pelas-saidas-do-imovel-lidas-por-id-sem-mudar-o-resumo-e-comecar-outra-saida-pede-confirmacao-184.md) | A entrada com saída se descobre pelas saídas do imóvel lidas por id, sem mudar o resumo, e começar outra saída pede confirmação (#184) | Proposto | 2026-11-13 |
| [0060](0060-o-historico-do-imovel-e-uma-linha-do-tempo-pela-data-de-inicio-em-abas-abaixo-de-1280-px-e-num-card-ao-lado-do-formulario-acima-e-a-tela-de-campo-e-o-laudo-voltam-pelo-voltar-so-com-caminho-do-app-176.md) | O histórico do imóvel é uma linha do tempo pela data de início, em abas abaixo de 1280 px e num Card ao lado do formulário acima, e a tela de campo e o laudo voltam pelo ?voltar= só com caminho do app (#176) | Proposto | 2026-11-13 |
