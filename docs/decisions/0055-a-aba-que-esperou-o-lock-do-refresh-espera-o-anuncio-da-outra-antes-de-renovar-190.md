# 0055 — A aba que esperou o lock do refresh espera o anúncio da outra antes de renovar (#190)

- **Status:** Proposto
- **Data:** 2026-11-10

## Contexto

Pela [Segurança](../architecture/frontend.md#segurança) ("Refresh em uma aba só"), a aba que pega o Web Lock `auth-refresh` renova, grava a data da renovação no localStorage e anuncia o token novo por `BroadcastChannel`. A aba que entra no lock em seguida só pulava o refresh se visse a data mais nova ou o anúncio, a correção do #135. No navegador, cada aba é um processo: a data, o anúncio e a vez no lock chegam por canais diferentes e sem ordem entre eles. Sob carga, a segunda aba ganhava o lock ainda com a data antiga e sem o anúncio, e pedia o próprio refresh. O `spike:device` pegou dois refresh 200 no CI duas vezes (runs 42833690720 e 42874796752). O teste da sessão no jsdom não enxergava a corrida, porque lá o localStorage é um só e síncrono.

## Decisão

O `refreshLock` diz se o lock estava com outra aba quando esta pediu: primeiro um pedido `ifAvailable`, e só com ele ocupado o pedido que espera. Quem esperou o lock trata isso como sinal de que outra aba renovou e espera o anúncio (até `ANNOUNCE_WAIT_MS`, 1 s) antes de chamar o `refreshToken`. A data no localStorage continua valendo como segundo sinal.

## Consequências

O sinal vem do mesmo canal que serializa as abas, então não depende da ordem de entrega da data nem do anúncio. Custos aceitos:
- Se a aba que segurava o lock não renovou (sem rede, refresh recusado ou outro dono), a que entra espera até 1 s antes de tentar.
- Todo pedido de renovação passa a fazer dois pedidos ao `LockManager` quando há contenção.
- A garantia continua dependendo de o anúncio chegar em até 1 s depois da vez no lock. Um navegador muito carregado ainda pode renovar duas vezes, e a tolerância de rotação da API cobre esse caso.
- A corrida não se reproduziu localmente, nem com a CPU 4× mais lenta. A causa vem da leitura do protocolo e de um teste que a simula; a prova final é o `e2e` estável no CI.
