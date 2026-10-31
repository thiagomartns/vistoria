# 0046 — Troca de usuário e saída: o token novo só vira sessão depois de confirmar, a limpeza esvazia a outbox antes do deleteDatabase, e a janela offline sem data conta como vencida (#133)

- **Status:** Proposto
- **Data:** 2026-10-31

## Contexto

A [Sessão e os Dados no aparelho](../architecture/frontend.md#segurança) pedem: login de outro usuário avisa que as pendências do anterior se perdem e só apaga depois de confirmar; "Sair" chama o `signOut` e apaga banco, outbox e caches; passadas 72 h da última renovação aceita, a UI trava. Três detalhes ficavam em aberto: o que fazer com o token da conta nova enquanto a pessoa decide, como apagar quando o adaptador IndexedDB da outbox nunca fecha a própria conexão (o `deleteDatabase` fica bloqueado até a página sair), e de onde contar a janela num aparelho sem a data da renovação (anterior ao #132).

## Decisão

- O login (e o cadastro, que é sempre outro `user.id`) de outra conta com pendências do dono anterior devolve uma decisão: o token novo fica só nela. Confirmar apaga o banco do anterior e só então começa a sessão nova; cancelar chama o `signOut` da conta nova. Sem pendências, apaga e entra sem perguntar. Pendências = fila da outbox + rascunhos recusados ou em conflito.
- A limpeza esvazia a outbox (`clearOutbox`) com o banco aberto, fecha tudo e então pede o `deleteDatabase` do banco local e da outbox, sem esperar o `blocked`. O "Sair" esquece a sessão primeiro, roda `signOut` e limpeza juntos (o erro de rede do `signOut` é engolido) e termina recarregando a página no `/login`.
- Sem a data da última renovação, a janela offline conta como vencida: bloqueia até um refresh aceito, sem apagar nada.

## Consequências

Nada da conta nova vale antes da decisão, e a fila do anterior some de verdade mesmo com o delete do banco bloqueado. Custos aceitos:
- Cancelar o aviso de outro usuário deixa o anterior sem cookie (o login da conta nova o trocou): ele precisa entrar de novo.
- Outra aba aberta do mesmo usuário segura o `deleteDatabase` do banco local até fechar; a outbox já está vazia, mas os registros sincronizados e os rascunhos ficam no disco até lá.
- Um aparelho de antes do #132, aberto offline, trava na primeira abertura até ter rede.
