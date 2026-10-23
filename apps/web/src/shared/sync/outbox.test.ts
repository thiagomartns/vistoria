// @vitest-environment node

import {
  type CreateOfflineTransactionOptions,
  NonRetriableError,
} from "@tanstack/offline-transactions";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type Outbox,
  RejectedSyncError,
  RetryableSyncError,
  enqueue,
  outboxHeaders,
  readRetryAfter,
  shouldRetry,
  syncFailure,
  waitRetryAfter,
} from "./outbox";

const problem = (type: string, status: number) => ({
  error: {
    type: `urn:vistoria:problem:${type}`,
    title: type,
    status,
    detail: type,
    traceId: "00-trace",
  },
  response: new Response(null, { status }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncFailure", () => {
  it.each([
    ["rede", { error: new TypeError("Failed to fetch") }],
    [
      "resposta sem ProblemDetails (502 do proxy)",
      { error: "<html>", response: new Response(null, { status: 502 }) },
    ],
    ["internal", problem("internal", 500)],
    ["rate-limited", problem("rate-limited", 429)],
    ["idempotency-in-progress", problem("idempotency-in-progress", 409)],
    ["unauthorized (a sessão expira; ver outbox-session.test.ts)", problem("unauthorized", 401)],
  ])("%s → tenta de novo", (_, result) => {
    const error = syncFailure(result);

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect(shouldRetry(error)).toBe(true);
  });

  it.each([
    ["validation", 400, "back-to-draft"],
    ["forbidden", 403, "discard-and-warn"],
    ["version-conflict", 409, "user-decision"],
    ["locked", 409, "accept-server"],
    ["idempotency-key-reused", 422, "bug"],
    ["precondition-required", 428, "bug"],
  ])("%s → sai da fila e só registra", (type, status, group) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const error = syncFailure(problem(type, status));

    expect(error).toBeInstanceOf(RejectedSyncError);
    expect(error).toBeInstanceOf(NonRetriableError);
    expect((error as RejectedSyncError).group).toBe(group);
    expect(shouldRetry(error)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("Retry-After", () => {
  const withRetryAfter = (type: string, status: number, value: string) => {
    const result = problem(type, status);
    result.response.headers.set("Retry-After", value);
    return result;
  };

  it.each([
    ["idempotency-in-progress", 409],
    ["rate-limited", 429],
  ])("%s: o erro leva o Retry-After em ms", (type, status) => {
    const error = syncFailure(withRetryAfter(type, status, "2"));

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect((error as RetryableSyncError).retryAfterMs).toBe(2_000);
  });

  it("ausente, ilegível ou data HTTP → só o backoff do executor; acima de 60 s, 60 s", () => {
    expect(readRetryAfter(new Response(null))).toBeUndefined();
    expect(readRetryAfter(undefined)).toBeUndefined();
    expect(
      readRetryAfter(new Response(null, { headers: { "Retry-After": "dois" } })),
    ).toBeUndefined();
    expect(readRetryAfter(new Response(null, { headers: { "Retry-After": "-1" } }))).toBeUndefined();
    expect(
      readRetryAfter(
        new Response(null, { headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" } }),
      ),
    ).toBeUndefined();
    expect(readRetryAfter(new Response(null, { headers: { "Retry-After": "3600" } }))).toBe(60_000);
  });

  it("waitRetryAfter espera só quando há Retry-After", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    await waitRetryAfter(syncFailure(withRetryAfter("idempotency-in-progress", 409, "1")), sleep);
    await waitRetryAfter(syncFailure(problem("internal", 500)), sleep);
    await waitRetryAfter(new Error("bug"), sleep);

    expect(sleep.mock.calls).toEqual([[1_000]]);
  });
});

describe("shouldRetry", () => {
  it("decide pelo tipo do erro, não pelo texto (a política padrão para em '401' e '400')", () => {
    const retry = new RetryableSyncError("retry", { kind: "network", cause: null });
    retry.message = "HTTP 401 400 422";

    expect(shouldRetry(retry)).toBe(true);
    expect(shouldRetry(new Error("HTTP 503"))).toBe(false);
  });
});

describe("outboxHeaders", () => {
  it("leva a chave da transação e, sem versão-base (criado no aparelho), nenhum If-Match", () => {
    expect(outboxHeaders("k")).toEqual({ "Idempotency-Key": "k" });
    expect(outboxHeaders("k", null)).toEqual({ "Idempotency-Key": "k" });
  });

  it("com versão-base, If-Match com o ETag forte (entre aspas)", () => {
    expect(outboxHeaders("k", "AAAAAAAAB9M=")).toEqual({
      "Idempotency-Key": "k",
      "If-Match": '"AAAAAAAAB9M="',
    });
  });
});

describe("enqueue", () => {
  function fakeOutbox(commit: () => Promise<unknown>) {
    const transaction = {
      mutate: vi.fn<(fn: () => void) => void>((fn) => fn()),
      commit: vi.fn<() => Promise<unknown>>(commit),
    };
    const create = vi.fn<(options: CreateOfflineTransactionOptions) => typeof transaction>(
      () => transaction,
    );
    return {
      outbox: { createOfflineTransaction: create } as unknown as Outbox,
      create,
      transaction,
    };
  }

  it("cria a transação com uma chave v7 nova, aplica a mudança e confirma", () => {
    const { outbox, create, transaction } = fakeOutbox(() => Promise.resolve());
    const mutate = vi.fn<() => void>();

    enqueue(outbox, "upsertClient", mutate);
    enqueue(outbox, "upsertClient", mutate);

    const [first, second] = create.mock.calls.map(([options]) => options);
    expect(first).toMatchObject({ mutationFnName: "upsertClient", autoCommit: false });
    expect(first?.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(transaction.commit).toHaveBeenCalledTimes(2);
  });

  it("não deixa a recusa como rejeição solta", async () => {
    const { outbox } = fakeOutbox(() => Promise.reject(new Error("recusada")));
    const unhandled = vi.fn<(reason: unknown) => void>();
    process.on("unhandledRejection", unhandled);

    enqueue(outbox, "upsertClient", () => {});
    await new Promise((done) => setTimeout(done, 0));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
