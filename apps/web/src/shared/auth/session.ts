import { type RenewOutcome, accessToken, readFailure } from "../api/client";
import {
  type AuthDto,
  type AuthUserDto,
  refreshToken,
  signIn,
  signOut,
  signUp,
} from "../api/generated";
import { zAuthUserDto } from "../api/generated/zod.gen";
import { type ApiFailure, handleProblem } from "../api/problems";
import { type Announcement, type RefreshLock, createRefreshLock } from "./refreshLock";

// Sessão (frontend.md, "Sessão"): o access token só em memória e o dono do aparelho (o `user.id` e o nome, que não são
// segredo) no localStorage. O refresh token é um cookie HttpOnly que o JavaScript nunca lê. Recarregar perde o token mas
// não o dono: com rede, o app renova antes de tudo (`renewing`) e volta ativo; sem rede, abre o banco local do dono e a
// outbox espera. A renovação sai numa aba só (refreshLock.ts) e também depois de um `unauthorized` (client.ts, ADR 0045)
// e quando a rede volta, antes da outbox e do pull.

export type SessionUser = AuthUserDto;

/**
 * - `signed-out`: ninguém entrou neste aparelho (ou saiu).
 * - `renewing`: há dono e o refresh está saindo (ao abrir com rede, ao voltar a rede, depois de um `unauthorized`).
 *   A outbox e o pull esperam; o shell não manda para o /login.
 * - `active`: o dono está com token; a outbox envia.
 * - `expired`: há dono, mas não há token (a API recusou o refresh, ou abriu sem rede). A outbox espera.
 */
export type SessionStatus = "signed-out" | "renewing" | "active" | "expired";

export interface SessionSnapshot {
  /** `false` no prerender e na hidratação, antes de ler o localStorage: ninguém decide nada por ele ainda. */
  ready: boolean;
  status: SessionStatus;
  user: SessionUser | null;
  /** A última renovação aceita neste aparelho (refresh ou login): de onde conta a janela offline. */
  renewedAt: Date | null;
}

const OWNER_KEY = "vistoria.owner";
const RENEWED_AT_KEY = "vistoria.renewed-at";

const SERVER_SNAPSHOT: SessionSnapshot = {
  ready: false,
  status: "signed-out",
  user: null,
  renewedAt: null,
};

let snapshot: SessionSnapshot | undefined;
const listeners = new Set<() => void>();

/** O refresh desta aba em voo: quem pede outro no meio recebe o mesmo. */
let renewing: Promise<RenewOutcome> | null = null;
/** Os gatilhos já estão instalados (na primeira assinatura). */
let started = false;
/** Ainda na abertura: nem a renovação da abertura nem um login decidiram a sessão. */
let opening = true;
/** A rede caiu (ou abriu sem ela): na volta, renova antes da outbox e do pull. */
let renewOnReconnect = false;
let lock: RefreshLock | undefined;
/**
 * A última renovação que esta aba conhece: a do token que ela tem (o login, o próprio refresh ou o anúncio adotado) ou,
 * sem token, a de quando abriu. Uma data mais nova no localStorage diz que outra aba renovou depois, e o anúncio dela
 * está a caminho. `undefined` antes de a aba instalar os gatilhos: aí vale a data lida na hora.
 */
let knownRenewedAt: string | null | undefined;

const refreshLock = () => (lock ??= createRefreshLock());

function readOwner(): SessionUser | null {
  try {
    const parsed = zAuthUserDto.safeParse(JSON.parse(localStorage.getItem(OWNER_KEY) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeOwner(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(OWNER_KEY, JSON.stringify({ id: user.id, name: user.name }));
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Sem localStorage (navegação privada restrita): a sessão vale até recarregar.
  }
}

function writeRenewedAt(at: Date | null) {
  const value = at?.toISOString() ?? null;
  knownRenewedAt = value;
  try {
    if (value) localStorage.setItem(RENEWED_AT_KEY, value);
    else localStorage.removeItem(RENEWED_AT_KEY);
  } catch {
    // Sem localStorage, a janela offline não tem de onde contar (e vale como vencida).
  }
}

function readRenewedAt(): string | null {
  try {
    return localStorage.getItem(RENEWED_AT_KEY);
  } catch {
    return null;
  }
}

/** Quando a API aceitou a última renovação (refresh ou login) neste aparelho: de onde conta a janela offline. */
export function lastRenewedAt(): Date | null {
  try {
    const value = readRenewedAt();
    const at = value ? new Date(value) : null;
    return at && !Number.isNaN(at.getTime()) ? at : null;
  } catch {
    return null;
  }
}

/** Abrir com dono, sem token e com rede: a renovação da abertura vai sair assim que os gatilhos forem instalados. */
const openingRenewal = () => opening && !accessToken.get() && navigator.onLine;

function statusOf(user: SessionUser | null): SessionStatus {
  if (!user) return "signed-out";
  if (renewing || openingRenewal()) return "renewing";
  return accessToken.get() ? "active" : "expired";
}

function current(): SessionSnapshot {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (!snapshot) {
    const user = readOwner();
    snapshot = { ready: true, status: statusOf(user), user, renewedAt: lastRenewedAt() };
  }
  return snapshot;
}

function update(user: SessionUser | null) {
  snapshot = { ready: true, status: statusOf(user), user, renewedAt: lastRenewedAt() };
  for (const listener of listeners) listener();
}

/** O `sub` do JWT, sem validar nada: a API valida; aqui só se confere de quem é o token que o cookie trouxe. */
function subjectOf(token: string): string | null {
  try {
    const payload = token.split(".")[1] ?? "";
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub?: unknown;
    };
    return typeof claims.sub === "string" ? claims.sub.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Quanto uma aba espera o anúncio da outra que acabou de renovar, antes de pedir o próprio refresh. */
export const ANNOUNCE_WAIT_MS = 1000;

const announced = new Set<() => void>();

/** Espera o anúncio de um token do dono por outra aba, até `ms`: `true` se chegou. */
function nextAnnouncement(ms: number): Promise<boolean> {
  return new Promise((done) => {
    const arrived = () => {
      clearTimeout(timer);
      announced.delete(arrived);
      done(true);
    };
    const timer = setTimeout(() => {
      announced.delete(arrived);
      done(false);
    }, ms);
    announced.add(arrived);
  });
}

/**
 * Renova pelo cookie, já com o lock entre abas. Se outra aba renovou depois do token que esta tem, não sai outro
 * refresh: o token anunciado já chegou, ou chega logo. A data da renovação é gravada antes de a outra aba soltar o lock,
 * e o anúncio pode chegar depois do lock, ou depois de esta aba pedir a renovação (#135). O cookie é do navegador, não da aba: um token de outro usuário (outra aba
 * entrou com outra conta) não vale para este dono, porque a fila de um nunca sai com a conta do outro.
 */
async function refreshAs(
  owner: SessionUser,
  before: string | null,
  renewedBefore: string | null,
): Promise<RenewOutcome> {
  const changed = () => {
    const now = accessToken.get();
    return now !== null && now !== before;
  };
  if (changed()) return "renewed";
  if (readRenewedAt() !== renewedBefore && (await nextAnnouncement(ANNOUNCE_WAIT_MS))) {
    return "renewed";
  }
  if (changed()) return "renewed";
  const result = await refreshToken();
  if (current().user?.id !== owner.id) return "expired";
  if (result.data) {
    const token = result.data.accessToken;
    if (subjectOf(token) !== owner.id.toLowerCase()) {
      accessToken.set(null);
      return "expired";
    }
    accessToken.set(token);
    writeRenewedAt(new Date());
    refreshLock().announce({ userId: owner.id, accessToken: token });
    return "renewed";
  }
  if (handleProblem(readFailure(result)) === "renew-session") {
    accessToken.set(null);
    return "expired";
  }
  // Sem resposta, 429 ou 5xx: nada foi decidido. Fica como estava e tenta de novo no próximo gatilho.
  return "offline";
}

/**
 * Renova o access token pelo cookie: `renewed`, `expired` (refresh recusado: a sessão expira, o dono e a outbox
 * ficam, e o login do mesmo usuário retoma a fila) ou `offline`. Um por vez na aba, e entre abas pelo lock. Durante a
 * renovação a sessão fica `renewing`; uma sessão que saiu ou trocou de dono no meio descarta o resultado.
 */
export function renewSession(): Promise<RenewOutcome> {
  if (renewing) return renewing;
  const owner = current().user;
  if (!owner) return Promise.resolve("expired");
  const before = accessToken.get();
  const renewedBefore = knownRenewedAt === undefined ? readRenewedAt() : knownRenewedAt;
  renewing = refreshLock()
    .run(() => refreshAs(owner, before, renewedBefore))
    .catch((): RenewOutcome => "offline")
    .then((outcome) => {
      if (outcome === "renewed") renewOnReconnect = false;
      return outcome;
    })
    .finally(() => {
      renewing = null;
      update(current().user);
    });
  update(owner);
  return renewing;
}

/**
 * A rede voltou: renova antes de a outbox e o pull saírem. Quem percebe a volta primeiro (o listener da sessão, o
 * detector da outbox ou os gatilhos do pull) já deixa a sessão `renewing`, e os outros veem `canSendAs` falso.
 */
export function renewAfterReconnect(): void {
  if (!renewOnReconnect || !navigator.onLine || !current().user) return;
  renewOnReconnect = false;
  void renewSession();
}

const markReconnect = () => {
  renewOnReconnect = true;
};

/** O token que outra aba renovou, se for do mesmo dono. */
function adopt({ userId, accessToken: token }: Announcement) {
  const { user } = current();
  if (user?.id !== userId) return;
  accessToken.set(token);
  knownRenewedAt = readRenewedAt();
  renewOnReconnect = false;
  update(user);
  for (const arrived of [...announced]) arrived();
}

/** Instala os gatilhos e faz a renovação da abertura: com dono, sem token e com rede. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  opening = false;
  knownRenewedAt = readRenewedAt();
  window.addEventListener("online", renewAfterReconnect);
  window.addEventListener("offline", markReconnect);
  refreshLock().onAnnounce(adopt);
  const { user } = current();
  if (user && !accessToken.get()) {
    if (navigator.onLine) {
      void renewSession();
      return;
    }
    renewOnReconnect = true;
  }
  update(user);
}

/** Store para o `useSyncExternalStore`. A primeira assinatura instala os gatilhos da renovação. */
export const sessionStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    start();
    return () => listeners.delete(listener);
  },
  getSnapshot: current,
  getServerSnapshot: (): SessionSnapshot => SERVER_SNAPSHOT,
};

/** A outbox de `ownerId` só envia com a sessão ativa desse mesmo usuário: nunca com o token de outro. */
export function canSendAs(ownerId: string): boolean {
  const { status, user } = current();
  return status === "active" && user?.id === ownerId;
}

/** O dono do aparelho (quem entrou por último e não saiu), com ou sem token. */
export function currentOwner(): SessionUser | null {
  return current().user;
}

/**
 * Começa a sessão com o que a API devolveu no login ou no cadastro: o token, o dono e a data da renovação. Quem chama
 * já decidiu o que fazer com o banco local de um dono anterior (outro usuário, ADR 0046).
 */
export function beginSession({ accessToken: token, user }: AuthDto) {
  accessToken.set(token);
  writeOwner(user);
  writeRenewedAt(new Date());
  renewOnReconnect = false;
  opening = false;
  update(user);
}

/** O que a API respondeu ao login ou ao cadastro, sem virar sessão ainda. */
export type Authentication = { ok: true; auth: AuthDto } | { ok: false; failure: ApiFailure };

/** Confere e-mail e senha na API. O token só vira sessão com `beginSession`. */
export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<Authentication> {
  const result = await signIn({ body: { email, password } });
  return result.data
    ? { ok: true, auth: result.data }
    : { ok: false, failure: readFailure(result) };
}

/** Cria a conta na API (sem verificação de e-mail na V1). O token só vira sessão com `beginSession`. */
export async function authenticateNewAccount(
  name: string,
  email: string,
  password: string,
): Promise<Authentication> {
  const result = await signUp({ body: { name, email, password } });
  return result.data
    ? { ok: true, auth: result.data }
    : { ok: false, failure: readFailure(result) };
}

/** Entra com e-mail e senha, sem olhar o banco local; devolve a falha, ou `null` com a sessão já ativa. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<ApiFailure | null> {
  const result = await authenticateWithPassword(email, password);
  if (!result.ok) return result.failure;
  beginSession(result.auth);
  return null;
}

/** Cria a conta e já entra, sem olhar o banco local; devolve a falha, ou `null` com a sessão ativa. */
export async function signUpWithPassword(
  name: string,
  email: string,
  password: string,
): Promise<ApiFailure | null> {
  const result = await authenticateNewAccount(name, email, password);
  if (!result.ok) return result.failure;
  beginSession(result.auth);
  return null;
}

/**
 * Um `unauthorized` chegou a quem chamou: o client já tentou renovar (ADR 0045), então a sessão expirou. O dono fica, e
 * a outbox para até o mesmo usuário entrar de novo.
 */
export function expireSession(): void {
  opening = false;
  accessToken.set(null);
  update(current().user);
}

/**
 * Esquece a sessão neste aparelho: o token, o dono e a data da renovação. Não toca no banco local nem na API: sair de
 * verdade é `signOutOnDevice` (local-store), que também apaga os dados e chama `signOutOnServer`.
 */
export function signOutSession(): void {
  accessToken.set(null);
  writeOwner(null);
  writeRenewedAt(null);
  renewOnReconnect = false;
  update(null);
}

/** Quanto o `signOut` espera a API antes de desistir: sem resposta, a limpeza local já aconteceu ou acontece. */
export const SIGN_OUT_TIMEOUT_MS = 5000;

/**
 * `signOut` na API: revoga a família do refresh token e apaga o cookie. Sem rede, ou com qualquer erro, não faz nada:
 * o erro de rede nunca impede a limpeza local, e o cookie que sobrar não vale para outro dono (ADR 0045).
 */
export async function signOutOnServer(): Promise<void> {
  try {
    await signOut({ signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS) });
  } catch {
    // Sem resposta: a família expira sozinha no prazo do refresh token.
  }
}

accessToken.renew = renewSession;

/** Esquece o estado em memória, como um reload. Só para testes. */
export function resetSession(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("online", renewAfterReconnect);
    window.removeEventListener("offline", markReconnect);
  }
  lock?.close();
  lock = undefined;
  accessToken.set(null);
  snapshot = undefined;
  renewing = null;
  knownRenewedAt = undefined;
  started = false;
  opening = true;
  renewOnReconnect = false;
  listeners.clear();
}
