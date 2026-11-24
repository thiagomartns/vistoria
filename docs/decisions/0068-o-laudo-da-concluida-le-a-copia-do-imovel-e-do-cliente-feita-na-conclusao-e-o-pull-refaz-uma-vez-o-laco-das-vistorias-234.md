# 0068 — O laudo da concluída lê a cópia do imóvel e do cliente feita na conclusão, e o pull refaz uma vez o laço das vistorias (#234)

- **Status:** Proposto
- **Data:** 2026-11-23

## Contexto

A [concluída é imutável e o laudo vale como prova](../vision.md#decisões-de-produto). Mas o laudo montava "Imóvel", "Tipo de imóvel" e "Cliente" com os registros atuais do aparelho. Por isso, a mesma concluída podia sair diferente depois de uma edição, de um pull ou do `ConflictResolver`, e saía com "—" num aparelho sem o imóvel. A #185 facilitou o problema: trocar o CEP troca o endereço inteiro. O [ADR 0053](0053-a-autoria-da-conclusao-e-gravada-pelo-servidor-com-o-nome-copiado-e-as-concluidas-de-antes-ganham-a-do-dono-183.md) já copia o nome de quem concluiu. Ele conta com o delta para levar a autoria aos aparelhos, mas não previa o aparelho que continua num build antigo. Esse aparelho descarta a chave nova, avança o cursor e depois trata o reenvio como eco, porque a versão é a mesma.

## Decisão

O `PUT` que conclui grava o `completedSnapshot`, lido do banco e nunca do corpo:
- do imóvel: endereço e tipo;
- do cliente: nome e documento.

A migração preenche as concluídas de antes com os dados de hoje. No aparelho, o `completedSnapshot` segue a regra do `completedBy` e alimenta o laudo; sem ele, o laudo usa o imóvel e o cliente atuais. A saída mostra o endereço da entrada quando ele for outro.

Cada laço do pull tem uma revisão. O cursor guarda a revisão do laço que o levou do zero ao fim. Um cursor de revisão menor refaz uma vez o resync do [ADR 0043](0043-rascunho-limpo-nao-segura-o-pull-e-o-resync-varre-no-fim.md) ([Leitura (pull)](../architecture/frontend.md#leitura-pull)), e esse resync regrava também o registro de mesma versão. As vistorias passam à revisão 2, sem subir o `LOCAL_DB_VERSION`.

O formulário de imóvel e o de cliente avisam ao salvar quando a mudança afeta o laudo de vistorias existentes.

## Consequências

O laudo de uma concluída fica igual em qualquer aparelho e em qualquer data, mesmo sem o imóvel no aparelho. A revisão serve para o próximo campo novo de qualquer laço. Custos aceitos:
- Um erro de digitação no endereço fica no laudo das concluídas: corrigir é o adendo da #236.
- A lista e a busca continuam pelo imóvel atual, e entrada e saída do mesmo imóvel podem mostrar endereços diferentes.
- Cada aparelho baixa todas as vistorias uma vez depois do deploy, e no resync de revisão regrava cada uma.
- Os dados ficam duplicados em cada concluída, e as concluídas de antes recebem os dados de hoje, não os da conclusão.
