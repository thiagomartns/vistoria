# 0021 — Formulário editável com transação na fila

- **Status:** Aceito
- **Data:** 2026-10-19

## Contexto

O [frontend](../architecture/frontend.md#formulários-profundos) dizia que o formulário fica só leitura enquanto está na outbox. Em campo, sem sinal (subsolo, imóvel vazio), uma transação pode ficar horas na fila, e essa regra travaria a vistoria. A decisão foi tomada no design da tela de campo (#9), nos estados "Offline" e "Enviando".

## Decisão

O formulário segue editável com transações na fila. Cada edição é salva no rascunho e vira transação pelas regras da [Escrita (push)](../architecture/frontend.md#escrita-push): é compactada na anterior se ela nunca foi enviada e encadeada depois dela se já teve tentativa. A UI só fica somente leitura enquanto uma requisição daquele registro está em voo (segundos) e depois de concluir, porque concluída é imutável.

## Consequências

Trabalhar offline o dia inteiro não trava nada, e o protocolo da outbox não muda. Custo aceito: o mesmo registro pode ter várias transações encadeadas. Um conflito ou uma rejeição numa transação antiga chega quando já há edições mais novas por cima, e o merge de três vias e a volta ao rascunho passam a tratar esse caso com mais frequência. O estado "Enviando" bloqueia a edição por um instante a cada envio.
