# 0054 — O laudo só abre com a conclusão confirmada pelo servidor, e a impressão fica no CSS do navegador (#168)

- **Status:** Proposto
- **Data:** 2026-11-10

## Contexto

O laudo é uma página do front, convertida em PDF pelo navegador e disponível offline ([Decisões de produto](../vision.md#decisões-de-produto), [Shell Next, PWA e rotas](../architecture/frontend.md#shell-next-pwa-e-rotas)). Ele vale como prova, e a prova está nos dados que só o servidor grava: o `completedAt`, o `completedBy` e a `version` ([ADR 0050](0050-a-vistoria-local-guarda-o-completedat-do-servidor-fora-do-corpo-do-put-a-conclusao-encerra-o-rascunho-e-a-conclusao-recusada-volta-para-inprogress-179.md), [ADR 0053](0053-a-autoria-da-conclusao-e-gravada-pelo-servidor-com-o-nome-copiado-e-as-concluidas-de-antes-ganham-a-do-dono-183.md)). Concluída offline, a vistoria fica na fila sem nenhum deles. A nota do wireframe mandava a vistoria em andamento para a tela de campo, enquanto a #168 pedia um aviso. A impressão precisa de folha A4, quebra por ambiente e paginação sem o shell.

## Decisão

`/inspections/report?id=` lê só do banco local, sem `GET`, e mostra a folha apenas quando o registro tem o `completedAt`. Concluída sem ele (conclusão na fila), em andamento ou desconhecida, a tela mostra um aviso no lugar do laudo, com o caminho de volta (Figma 177:16524, estados 4 a 6), sem redirecionar. Os links "Ver laudo" e "Laudo" só aparecem na concluída e confirmada. A impressão é CSS: o `@page` define A4, margem e "Página N de M" no rodapé; as classes `print:` escondem o shell e o fundo; e cada ambiente a partir do segundo começa numa página nova, sem cortar item.

## Consequências

O laudo nunca sai sem a data e a autoria do servidor, abre em modo avião e não pede infraestrutura de PDF na API. Custos aceitos:
- Quem concluiu sem rede só imprime depois de sincronizar. O aviso diz isso, mas o laudo não fica disponível na hora, no imóvel.
- Uma vistoria que o aparelho ainda não baixou é "não encontrada", mesmo com rede.
- O PDF depende do motor de impressão do navegador. Margin boxes e `counter(pages)` funcionam no Chrome, mas outros navegadores podem paginar diferente. O rodapé do `@page` é fixo ("Avis · Laudo de vistoria"), porque ele não lê texto da página; a identificação fica no corpo.
- Um ambiente por página gasta papel em ambientes pequenos, e o servidor não guarda cópia do PDF. Assinatura e envio ficam para versões futuras.
