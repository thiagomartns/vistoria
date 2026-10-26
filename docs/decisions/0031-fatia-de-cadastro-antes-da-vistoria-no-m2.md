# 0031 — Fatia de cadastro antes da vistoria no M2

- **Status:** Aceito
- **Data:** 2026-10-22

## Contexto

O roteiro fecharia as quatro entidades do M1 (Template e o agregado Inspection, #24 a #26) antes de qualquer sync de verdade ([Marcos](../vision.md#marcos)). A promessa central ("nenhum registro se perde") depende do `If-Match` e da idempotência no servidor (fases 4 e 5 do [Roteiro de estudo](../architecture/backend.md#roteiro-de-estudo)) e da outbox contra eles (spike 1b). Nada disso existe ainda, e até lá não haveria uma tela usável. Client e Property já têm `GET` e `PUT` na API, e a outbox do spike 1a já escreve clients.

## Decisão

O M2 começa por uma fatia vertical de cadastro. No celular, entrar, cadastrar cliente e imóvel offline, recarregar, voltar a rede e entrar de novo: os dois chegam ao SQL Server uma vez só e aparecem em `/clients` e `/properties`. A fatia traz as fases 4 e 5 em Client e Property, o spike 1b, o shell e PWA (spike 4, sem o teste de duas abas), login e as telas de clientes e imóveis. Ela é só escrita, num aparelho. A vistoria offline (Template, Inspection, fase 3 e tela de campo) é a segunda entrega do M2.

## Consequências

O risco técnico do projeto é enfrentado primeiro e sobre entidades simples, e cada passo vira algo que dá para usar. Custos aceitos:
- Template e Inspection ficam para depois, e o M1 entrega só Client e Property.
- O upsert genérico (fase 4) nasce antes do agregado da vistoria e pode precisar de ajuste no #25.
- Sem refresh (fase 6), recarregar offline perde o access token: ao voltar a rede, o app pede login de novo até o M4.
- Sem delta (fase 6), o notebook não vê o que o celular cadastrou até o M4.
