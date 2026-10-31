import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Duas abas do mesmo dono com o token vencido (frontend.md, "Sessão"): cada aba é uma instância própria da sessão e do
// client (token em memória), sobre o mesmo localStorage, o mesmo lock `auth-refresh` e o mesmo BroadcastChannel.

const api = vi.hoisted(() => ({ refresh: vi.fn<() => Promise<unknown>>() }));

vi.mock("../api/generated", async (original) => ({
  ...(await original<typeof import("../api/generated")>()),
  refreshToken: () => api.refresh(),
}));

const user = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Thiago Martins" };
const tokenOf = (sub: string, n: number) =>
  `h${n}.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

/** Um LockManager que serializa os pedidos do mesmo nome, como o do navegador entre abas. */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request: vi.fn<(name: string, fn: () => Promise<unknown>) => Promise<unknown>>((_name, fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => {});
      return run;
    }),
  };
}

type Tab = {
  session: typeof import("./session");
  client: typeof import("../api/client");
};

/** Abre uma aba: módulos novos, com o token vencido em memória e os gatilhos instalados. */
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const client = await import("../api/client");
  const session = await import("./session");
  client.accessToken.set("vencido");
  session.sessionStore.subscribe(() => {});
  return { session, client };
}

let tabs: Tab[] = [];

beforeEach(() => {
  localStorage.setItem("vistoria.owner", JSON.stringify(user));
});

afterEach(() => {
  for (const tab of tabs) tab.session.resetSession();
  tabs = [];
  localStorage.clear();
  api.refresh.mockReset();
  Reflect.deleteProperty(navigator, "locks");
});

describe("duas abas com o token vencido", () => {
  it("com Web Locks: um refresh só, e as duas seguem com o token novo", async () => {
    const locks = fakeLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    let issued = 0;
    api.refresh.mockImplementation(async () => {
      issued += 1;
      return { data: { accessToken: tokenOf(user.id, issued), expiresAt: "2026-10-31T15:00:00Z" } };
    });
    tabs = [await openTab(), await openTab()];
    const [a, b] = tabs as [Tab, Tab];

    const outcomes = await Promise.all([a.session.renewSession(), b.session.renewSession()]);

    expect(outcomes).toEqual(["renewed", "renewed"]);
    expect(locks.request).toHaveBeenCalledTimes(2);
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(a.client.accessToken.get()).toBe(tokenOf(user.id, 1));
    expect(b.client.accessToken.get()).toBe(tokenOf(user.id, 1));
    expect(b.session.sessionStore.getSnapshot().status).toBe("active");
  });

  it("sem Web Locks: cada aba renova (a tolerância da API cobre a corrida) e as duas seguem", async () => {
    let issued = 0;
    api.refresh.mockImplementation(async () => {
      issued += 1;
      return { data: { accessToken: tokenOf(user.id, issued), expiresAt: "2026-10-31T15:00:00Z" } };
    });
    tabs = [await openTab(), await openTab()];
    const [a, b] = tabs as [Tab, Tab];

    const outcomes = await Promise.all([a.session.renewSession(), b.session.renewSession()]);

    expect(outcomes).toEqual(["renewed", "renewed"]);
    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(a.session.sessionStore.getSnapshot().status).toBe("active");
    expect(b.session.sessionStore.getSnapshot().status).toBe("active");
  });

  it("o anúncio de outro dono não vale nesta aba", async () => {
    tabs = [await openTab()];
    const [a] = tabs as [Tab];
    const channel = new BroadcastChannel("auth-refresh");

    channel.postMessage({
      userId: "0199a0b2-7c1e-7f3a-9b2d-ffffffffffff",
      accessToken: "de-outro",
    });
    await new Promise((done) => setTimeout(done, 20));
    channel.close();

    expect(a.client.accessToken.get()).toBe("vencido");
  });
});
