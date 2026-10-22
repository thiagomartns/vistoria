/// <reference lib="webworker" />
import { type PrecacheEntry, Serwist } from "serwist";

// Service worker do app (frontend.md, "Shell Next, PWA e rotas"; ADR 0032). Só pré-cache: o static export
// inteiro (HTML, payloads RSC, chunks, fontes, ícones) entra no install, e abrir o app depois disso não
// depende de rede. Requisição à API nunca passa por aqui: dado é da camada de sync.

declare const self: ServiceWorkerGlobalScope & {
  /** Lista do pré-cache, injetada pelo `serwist build` (serwist.config.mjs). */
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const serwist = new Serwist({
  // oxlint-disable-next-line no-underscore-dangle -- nome fixo do ponto de injeção do Serwist
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    // Rota sem segmento dinâmico: `/clients/edit?id=…` é o mesmo HTML de `/clients/edit`, qualquer que seja o id.
    // Com `cleanURLs` (padrão), `/clients/edit` casa com o `clients/edit.html` pré-cacheado.
    ignoreURLParametersMatching: [/.*/],
  },
  // Sem skipWaiting: a versão nova fica em espera. Ativar só com a outbox vazia é de outra issue.
});

serwist.addEventListeners();
