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

/**
 * Um LockManager que serializa os pedidos do mesmo nome, como o do navegador entre abas. Com `{ ifAvailable: true }`,
 * concede na hora se ninguém segura o lock, e senão chama o callback com `null`, sem esperar.
 */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  let held = 0;
  type Callback = (lock: { name: string } | null) => Promise<unknown>;
  return {
    request: vi.fn<(name: string, ...args: [Callback] | [{ ifAvailable?: boolean }, Callback]) => Promise<unknown>>(
      (name, ...args) => {
        const [options, fn] = args.length === 2 ? args : [{}, args[0]];
        if (options.ifAvailable && held > 0) return Promise.resolve().then(() => fn(null));
        const run = tail.then(async () => {
          held += 1;
          try {
            return await fn({ name });
          } finally {
            held -= 1;
          }
        });
        tail = run.catch(() => {});
        return run;
      },
    ),
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

  it("a outra aba já gravou a renovação e o anúncio ainda não chegou: espera o anúncio, sem outro refresh", async () => {
    // A corrida do spike:device no CI (#135): a aba A renovou e gravou a data antes de anunciar, e o 401 da aba B
    // chegou nesse meio. A data lida na hora da chamada já era a nova, e a aba B pedia o próprio refresh.
    const locks = fakeLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    api.refresh.mockResolvedValue({
      data: { accessToken: tokenOf(user.id, 9), expiresAt: "2026-10-31T15:00:00Z" },
    });
    tabs = [await openTab()];
    const [b] = tabs as [Tab];
    const otherTab = new BroadcastChannel("auth-refresh");
    localStorage.setItem("vistoria.renewed-at", "2026-10-31T14:45:00.000Z");

    const renewing = b.session.renewSession();
    setTimeout(() => otherTab.postMessage({ userId: user.id, accessToken: tokenOf(user.id, 1) }), 50);
    const outcome = await renewing;
    otherTab.close();

    expect(outcome).toBe("renewed");
    expect(api.refresh).not.toHaveBeenCalled();
    expect(b.client.accessToken.get()).toBe(tokenOf(user.id, 1));
  });

  it("a outra aba segurava o lock e a data dela ainda não chegou aqui: espera o anúncio, sem outro refresh", async () => {
    // A corrida do #190: no navegador, cada aba é um processo, e a data no localStorage, o anúncio e a vez no lock
    // chegam por canais diferentes, sem ordem entre eles. A aba B ganhava o lock ainda com a data antiga e sem o
    // anúncio, achava que ninguém tinha renovado e pedia o próprio refresh. O lock ocupado agora basta como sinal.
    const locks = fakeLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    api.refresh.mockResolvedValue({
      data: { accessToken: tokenOf(user.id, 9), expiresAt: "2026-10-31T15:00:00Z" },
    });
    tabs = [await openTab()];
    const [b] = tabs as [Tab];
    const otherTab = new BroadcastChannel("auth-refresh");
    // A aba A renova dentro do lock; aqui, o localStorage não muda (a gravação dela ainda não chegou a este processo).
    let release: (() => void) | undefined;
    void locks.request("auth-refresh", () => new Promise<void>((done) => (release = done)));
    await vi.waitFor(() => expect(release).toBeDefined());

    const renewing = b.session.renewSession();
    await new Promise((done) => setTimeout(done, 10));
    release?.();
    setTimeout(() => otherTab.postMessage({ userId: user.id, accessToken: tokenOf(user.id, 1) }), 50);
    const outcome = await renewing;
    otherTab.close();

    expect(outcome).toBe("renewed");
    expect(api.refresh).not.toHaveBeenCalled();
    expect(b.client.accessToken.get()).toBe(tokenOf(user.id, 1));
  });

  it("a outra aba segurava o lock e não renovou (sem rede): esta espera o prazo do anúncio e renova sozinha", async () => {
    const locks = fakeLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    api.refresh.mockResolvedValue({
      data: { accessToken: tokenOf(user.id, 9), expiresAt: "2026-10-31T15:00:00Z" },
    });
    tabs = [await openTab()];
    const [b] = tabs as [Tab];
    let release: (() => void) | undefined;
    void locks.request("auth-refresh", () => new Promise<void>((done) => (release = done)));
    await vi.waitFor(() => expect(release).toBeDefined());

    const renewing = b.session.renewSession();
    await new Promise((done) => setTimeout(done, 10));
    release?.();
    const outcome = await renewing;

    expect(outcome).toBe("renewed");
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(b.client.accessToken.get()).toBe(tokenOf(user.id, 9));
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
