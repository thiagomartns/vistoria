---
description: Cria o próximo ADR numerado a partir do template e atualiza o índice
argument-hint: <título da decisão>
---

Crie um ADR para a decisão "$ARGUMENTS".

1. Liste `docs/decisions/` e pegue o maior número `NNNN` existente; o novo é o seguinte, com 4 dígitos.
2. Monte o nome do arquivo: `NNNN-<slug>.md`, com o slug em minúsculas, sem acentos e com hífens
   (por exemplo, "Fotos na V2" → `0019-fotos-na-v2.md`).
3. Copie a estrutura de `docs/decisions/0000-template.md`: título `# NNNN — $ARGUMENTS`, Status `Proposto`
   e a data de hoje (AAAA-MM-DD).
4. Preencha Contexto, Decisão e Consequências com o que foi discutido nesta conversa. Se faltar informação,
   pergunte antes de inventar. No máximo 20 linhas. Consequências precisam dizer o **custo aceito**, não só
   o benefício. Link para a seção de `docs/` afetada.
5. Se o novo ADR substitui outro, **não edite o texto do antigo**: só troque o Status dele para
   `Substituído por NNNN` e diga no novo qual ele substitui.
6. Acrescente a linha do novo ADR na tabela de `docs/decisions/README.md`, mantendo a ordem numérica,
   e atualize o Status da linha substituída, se houver.
7. Lembre que o doc afetado em `docs/` precisa ser atualizado no mesmo PR.

Mostre o arquivo criado e o diff do índice. Não faça commit sem eu pedir.
