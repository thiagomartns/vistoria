import { afterEach, describe, expect, it, vi } from "vitest";

import { OUTBOX_FALLBACK_PREFIX, deleteDeviceDatabases } from "./wipe";

// O jsdom não tem IndexedDB: o teste confere os pedidos de delete, e o roteiro `spike:outbox` confere o navegador.

type Request = { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void };

function stubIndexedDB(answer: keyof Request) {
  const requests: string[] = [];
  vi.stubGlobal("indexedDB", {
    deleteDatabase: (name: string) => {
      requests.push(name);
      const request: Request = {};
      queueMicrotask(() => request[answer]?.());
      return request;
    },
  });
  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const ownerId = "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b";

describe("deleteDeviceDatabases", () => {
  it("apaga o banco local e o da outbox do usuário", async () => {
    const requests = stubIndexedDB("onsuccess");

    await deleteDeviceDatabases(ownerId);

    expect(requests.toSorted()).toEqual([`vistoria-${ownerId}`, `vistoria-outbox-${ownerId}`]);
  });

  it("não pendura quando uma conexão aberta segura o delete", async () => {
    stubIndexedDB("onblocked");

    await expect(deleteDeviceDatabases(ownerId)).resolves.toBeUndefined();
  });

  it("apaga o fallback da outbox em localStorage e deixa o resto", async () => {
    stubIndexedDB("onsuccess");
    localStorage.setItem(`${OUTBOX_FALLBACK_PREFIX}tx-1`, "{}");
    localStorage.setItem("outra-chave", "fica");

    await deleteDeviceDatabases(ownerId);

    expect(localStorage.getItem(`${OUTBOX_FALLBACK_PREFIX}tx-1`)).toBeNull();
    expect(localStorage.getItem("outra-chave")).toBe("fica");
  });
});
