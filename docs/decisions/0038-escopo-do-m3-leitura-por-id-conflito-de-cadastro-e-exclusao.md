# 0038 — Escopo do M3: leitura por id, conflito de cadastro e exclusão

- **Status:** Proposto
- **Data:** 2026-10-27

## Contexto

A entrega do M3 pede dois navegadores editando a mesma vistoria ([Marcos](../vision.md#marcos)), mas o segundo não tem como recebê-la: o front ainda não lê nada do servidor, e o delta só chega no M4 ([ADR 0031](0031-fatia-de-cadastro-antes-da-vistoria-no-m2.md), [Leitura](../architecture/frontend.md#leitura-pull)). O 412 de cliente e de imóvel vira um rascunho "conflito" sem saída, porque editar de novo manda a mesma versão-base. E o app não exclui nada, embora o `ConflictResolver` do Figma já tenha os tipos "excluído" e "exclusão alterada" ([Conflito](../architecture/frontend.md#conflito), [ADR 0008](0008-exclusao-soft-delete-com-tombstones.md)).

## Decisão

- Abrir pelo id um registro que não está no banco local busca no servidor pelo `GET` que já existe (`getInspection`, `getClient`, `getProperty`) e grava a resposta como `serverShadow`. O delta do M4 continua sendo a leitura de verdade.
- Conflito de cliente e de imóvel entra no M3, com o mesmo merge e o mesmo `ConflictResolver` da vistoria.
- Exclusão de vistoria em andamento entra no M3, com "excluído em outro aparelho" e "exclusão alterada".
- `locked` fica no M5, com concluir: o app ainda não conclui, então ninguém recebe `locked` antes disso.

## Consequências

O spike 3 roda de verdade em dois navegadores, e nenhum 412 deixa rascunho sem saída. Custos aceitos:
- Até o M4, um aparelho só tem o que abriu pelo id: listas e busca continuam só locais.
- O `GET` por id é código a mais que o delta torna secundário; ele fica como caminho para o link aberto num aparelho que ainda não puxou.
- O M3 cresce com cadastros e exclusão, e o risco de atraso vai para ele.
- A linha `locked` da [reação aos erros](../architecture/frontend.md#reação-aos-erros) fica sem implementação até o M5.
