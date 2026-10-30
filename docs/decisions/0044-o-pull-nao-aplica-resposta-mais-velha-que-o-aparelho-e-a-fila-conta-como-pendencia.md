# 0044 — O pull não aplica resposta mais velha que o aparelho, e a fila conta como pendência

- **Status:** Proposto
- **Data:** 2026-10-30

## Contexto

Os roteiros `spike:outbox` e `spike:conflict` falhavam de forma intermitente desde o #140: o pull cai a cada 60 s num ponto diferente do roteiro, e uma escrita feita no aparelho sumia (#144). A reprodução de cada janela no navegador achou três causas:

- **A resposta mais velha que a store.** O delta e o `GET` por id têm o servidor da hora em que ele os leu. Lidos antes de o envio daqui confirmar e entregues depois dele, eles chegam sem pendência e, pelo eco do [ADR 0042](0042-pull-grava-a-pagina-antes-do-cursor-e-reaplica-sem-efeito.md), que só compara a `version` por igualdade, gravam a versão de antes por cima da confirmada. O `rebaseClean` do [ADR 0043](0043-rascunho-limpo-nao-segura-o-pull-e-o-resync-varre-no-fim.md) leva o rascunho junto, e a tela de campo recarrega sem o que foi marcado. Na varredura do resync, o registro criado aqui e confirmado com o resync em voo não vem nas páginas e sairia do aparelho.
- **O envio em voo sem `$hasPendingWrites`.** Na collection IndexedDB, a camada otimista solta o `$hasPendingWrites` com o envio em voo. A outbox ainda tem a transação. O pull resolvia a marca pelo `GET`, gravava a versão do servidor, sem a marcação que estava no ar, e o rascunho regravado a apagava da tela.
- **O formulário plano.** Quando o pull muda o registro com o formulário aberto, o `values` do react-hook-form reseta. O `keepDirtyValues` mantém o que a pessoa digitou, mas zera o `isDirty`, e o "Salvar" não enfileirava nada.

## Decisão

Complementa o 0041, o 0042 e o 0043. Além da pendência do 0041, o pull pula o registro, que ganha a marca, quando:

- **A store mudou durante a resposta.** A página compara a store confirmada com a lida antes da requisição sair, e a varredura do resync com a do começo dele. O `GET` por id compara a `version` de antes e a de depois.
- **Há transação na outbox.** A fila (`peekOutbox`, com a transação em voo) conta como pendência, lida logo antes da conferência, sem `await` entre a conferência e a gravação.

Nos formulários planos, salvar enfileira o que difere do registro de agora, campo a campo. O `isDirty` deixa de decidir.

## Consequências

O que o aparelho confirmou nunca volta para uma versão mais velha, e o envio em voo não é atropelado pelo pull. Custos aceitos:
- Cada página lê a store confirmada uma vez a mais, antes da requisição. O spike 2 (#134) mede isso com 10 mil vistorias.
- O registro que mudou durante a resposta só recebe o servidor no ciclo seguinte, pela marca.
