# 0059 — a entrada com saída se descobre pelas saídas do imóvel lidas por id, sem mudar o resumo, e começar outra saída pede confirmação (#184)

- **Status:** Proposto
- **Data:** 2026-11-13

## Contexto

Um imóvel tem várias locações, cada uma com entrada e saída, mas duas saídas da mesma entrada são sempre engano, e a Nova vistoria não impedia isso ([ADR 0052](0052-a-saida-guarda-a-referencia-e-as-copias-no-registro-local-so-quando-existem-e-a-nova-vistoria-oferece-as-entradas-pelo-resumo-com-a-fila-por-cima-170.md)). A regra não pode ir para o servidor: dois aparelhos criam a saída offline, e um 400 seria erro que o vistoriador não corrige ([ADR 0051](0051-kind-referencia-e-copias-da-saida-sao-da-criacao-o-put-de-atualizacao-os-ignora-169.md)). O resumo de cada vistoria tem `propertyId` e `kind`, mas não o `referenceInspectionId` ([ADR 0048](0048-a-lista-de-vistorias-le-um-resumo-gravado-na-mesma-transacao-e-a-vistoria-completa-carrega-por-id.md)), e os resumos só são montados quando a store está vazia: um campo novo pediria a versão 8 do banco local e reconstruir os resumos de quem já tem milhares de vistorias.

## Decisão

A Nova vistoria acha pelo resumo, com a fila por cima, as saídas vivas do imóvel escolhido e lê só essas, inteiras, por id; os `referenceInspectionId` delas são as entradas com saída. No Select, essas entradas dizem "· já tem saída", a escolhida por padrão é a mais recente sem saída (ou a mais recente, se todas têm), e começar uma saída de uma delas pede confirmação num Dialog. A regra é aviso, não bloqueio.

## Consequências

O resumo e o banco local não mudam, sem migração, e a saída criada offline, ainda na fila, já marca a entrada. Custos aceitos:
- Uma leitura a mais por imóvel escolhido na saída, de todas as saídas dele; são poucas por imóvel, mas crescem com as locações.
- A saída que o aparelho não tem (de outro aparelho, ainda não baixada pelo pull) não marca a entrada: dois aparelhos offline ainda podem criar duas saídas da mesma entrada, e o servidor aceita as duas.
- Confirmar cria a segunda saída sem registro do aviso; quem a quiser desfazer a exclui.

Afeta [Formulários profundos](../architecture/frontend.md#formulários-profundos), a saída na Nova vistoria.
