import { outboxName } from "../sync/outbox";
import { localDbName } from "./local-db";

// O que um usuário deixa no aparelho fora da memória (frontend.md, "Dados no aparelho"): o banco local
// (`vistoria-<id>`), o armazenamento da outbox (`vistoria-outbox-<id>`) e, sem IndexedDB, o fallback da outbox em
// localStorage. Cache Storage não tem nada dele: o service worker só pré-cacheia o shell e nunca vê a API.

/** O prefixo do fallback da outbox em localStorage (o padrão do `LocalStorageAdapter` do offline-transactions). */
export const OUTBOX_FALLBACK_PREFIX = "offline-tx:";

/**
 * Pede para apagar o banco. Resolve no `success`, no `error` ou no `blocked`: uma conexão ainda aberta (o adaptador da
 * outbox nunca fecha a dele, outra aba) segura o delete até fechar, e o pedido fica na fila do navegador. Por isso quem
 * limpa esvazia a outbox antes (ADR 0046) e o "Sair" termina recarregando a página.
 */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((done) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => done();
    request.onerror = () => done();
    request.onblocked = () => done();
  });
}

/** Apaga os bancos de `ownerId` e o fallback da outbox. Quem chama já fechou o que estava aberto. */
export async function deleteDeviceDatabases(ownerId: string): Promise<void> {
  if (typeof indexedDB !== "undefined") {
    await Promise.all([deleteDatabase(localDbName(ownerId)), deleteDatabase(outboxName(ownerId))]);
  }
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
      if (key?.startsWith(OUTBOX_FALLBACK_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Sem localStorage, também não houve fallback.
  }
}
