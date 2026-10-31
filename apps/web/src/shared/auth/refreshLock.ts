// Refresh em uma aba só (frontend.md, "Sessão"): a aba que pega o lock `auth-refresh` chama o `refreshToken` e anuncia o
// access token novo por BroadcastChannel; as outras esperam o lock e reaproveitam o anunciado. Sem Web Locks, cada aba
// renova sozinha e a tolerância de rotação da API cobre a corrida; sem BroadcastChannel, nada é anunciado.

export const REFRESH_LOCK = "auth-refresh";

/** O token que uma aba renovou, para as outras do mesmo dono. Só em memória, nunca no armazenamento. */
export interface Announcement {
  userId: string;
  accessToken: string;
}

type Locks = Pick<LockManager, "request">;
type Channel = Pick<BroadcastChannel, "postMessage" | "close"> & {
  onmessage: ((event: MessageEvent) => void) | null;
};

export interface RefreshLock {
  /** Roda `fn` com o lock entre abas; sem Web Locks, roda direto. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  announce(message: Announcement): void;
  /** Um ouvinte só: o da sessão desta aba. */
  onAnnounce(listener: (message: Announcement) => void): void;
  close(): void;
}

function isAnnouncement(data: unknown): data is Announcement {
  if (typeof data !== "object" || data === null) return false;
  const { userId, accessToken } = data as Record<string, unknown>;
  return typeof userId === "string" && typeof accessToken === "string";
}

/** `locks` e `channel` vêm do navegador; `null` diz que não há (os testes). */
export function createRefreshLock({
  locks = globalThis.navigator?.locks ?? null,
  channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(REFRESH_LOCK),
}: { locks?: Locks | null; channel?: Channel | null } = {}): RefreshLock {
  return {
    run: (fn) => (locks ? locks.request(REFRESH_LOCK, fn) : fn()),
    announce: (message) => channel?.postMessage(message),
    onAnnounce(listener) {
      if (!channel) return;
      channel.onmessage = (event) => {
        if (isAnnouncement(event.data)) listener(event.data);
      };
    },
    close: () => channel?.close(),
  };
}
