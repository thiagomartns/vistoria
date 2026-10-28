// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ApiFailure } from "../api/problems";
import {
  type DraftRecord,
  type DraftsCollection,
  clearDraft,
  keepConflictData,
  needsAction,
  rebaseDraft,
  recordConflict,
  recordRejection,
  saveDraftValues,
  workingCopy,
} from "./drafts";

// O rascunho do formulário profundo (ADR 0036): guarda o passo e os valores, e recusa e conflito mudam só o status.

function collection() {
  const drafts = new Map<string, DraftRecord>();
  const fake = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: DraftRecord) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: DraftRecord) => void) => change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  return { drafts, fake };
}

const now = new Date("2026-10-26T13:00:00.000Z");
const later = new Date("2026-10-26T13:05:00.000Z");

const validation = (errors: Record<string, string[]>): ApiFailure =>
  ({
    kind: "problem",
    status: 400,
    problem: { type: "urn:vistoria:problem:validation", title: "Inválido", status: 400, errors },
  }) as unknown as ApiFailure;

describe("saveDraftValues", () => {
  it("cria o rascunho `draft` com os valores e o passo", () => {
    const { drafts, fake } = collection();

    saveDraftValues(fake, "inspection", "i1", { id: "i1", rooms: [] }, 2, now);

    expect(drafts.get("i1")).toEqual({
      id: "i1",
      entity: "inspection",
      data: { id: "i1", rooms: [] },
      status: "draft",
      errors: {},
      step: 2,
      updatedAt: now.toISOString(),
    });
  });

  it("atualiza valores e passo e mantém a recusa à vista", () => {
    const { drafts, fake } = collection();
    saveDraftValues(fake, "inspection", "i1", { id: "i1", v: 1 }, 0, now);
    recordRejection(
      fake,
      "inspection",
      { id: "i1", v: 0 },
      validation({ "rooms[0].items[0].condition": ["Escolha a condição."] }),
    );

    saveDraftValues(fake, "inspection", "i1", { id: "i1", v: 2 }, 1, later);

    expect(drafts.get("i1")).toMatchObject({
      data: { id: "i1", v: 2 },
      step: 1,
      status: "rejected",
      errors: { "rooms[0].items[0].condition": ["Escolha a condição."] },
      updatedAt: later.toISOString(),
    });
  });
});

describe("recusa e conflito no formulário profundo", () => {
  it("a recusa mantém os valores e o passo do rascunho (o mais novo que a pessoa marcou)", () => {
    const { drafts, fake } = collection();
    saveDraftValues(fake, "inspection", "i1", { id: "i1", v: "novo" }, 3, now);

    recordRejection(
      fake,
      "inspection",
      { id: "i1", v: "enviado" },
      validation({ propertyId: ["Imóvel não encontrado."] }),
    );

    expect(drafts.get("i1")).toMatchObject({
      data: { id: "i1", v: "novo" },
      step: 3,
      status: "rejected",
      errors: { propertyId: ["Imóvel não encontrado."] },
    });
  });

  it("o conflito também", () => {
    const { drafts, fake } = collection();
    saveDraftValues(fake, "inspection", "i1", { id: "i1", v: "novo" }, 1, now);
    const conflict = { current: { v: "servidor" }, base: { v: "antes" }, collisions: [{ field: "v" }] };

    recordConflict(fake, "inspection", { id: "i1", v: "enviado" }, conflict);

    expect(drafts.get("i1")).toMatchObject({ data: { v: "novo" }, step: 1, status: "conflict", conflict });
  });

  it("sem passo (cliente, imóvel), a recusa guarda o que foi enviado, como antes", () => {
    const { drafts, fake } = collection();
    recordRejection(fake, "client", { id: "c1", name: "A" }, validation({ name: ["Curto."] }));

    recordRejection(fake, "client", { id: "c1", name: "B" }, validation({ name: ["Curto."] }));

    expect(drafts.get("c1")).toMatchObject({ data: { id: "c1", name: "B" }, status: "rejected" });
    expect(drafts.get("c1")?.step).toBeUndefined();
  });
});

describe("clearDraft", () => {
  it("o rascunho com passo fica, como `draft`, sem erros nem conflito", () => {
    const { drafts, fake } = collection();
    saveDraftValues(fake, "inspection", "i1", { id: "i1" }, 2, now);
    recordRejection(
      fake,
      "inspection",
      { id: "i1" },
      validation({ "rooms[0].items[0].notes": ["Longa."] }),
    );

    clearDraft(fake, "i1");

    expect(drafts.get("i1")).toMatchObject({ status: "draft", errors: {}, step: 2 });
    expect(needsAction(drafts.get("i1"))).toBe(false);
  });

  it("sem passo, apaga", () => {
    const { drafts, fake } = collection();
    recordRejection(fake, "client", { id: "c1" }, validation({ name: ["Curto."] }));

    clearDraft(fake, "c1");

    expect(drafts.has("c1")).toBe(false);
  });

  it("sem rascunho, nada", () => {
    const { drafts, fake } = collection();

    clearDraft(fake, "x");

    expect(drafts.size).toBe(0);
  });
});

describe("rebaseDraft", () => {
  it("o rascunho com passo passa a ter o merge, como `draft`, e marca rebasedAt para a tela recarregar", () => {
    const { drafts, fake } = collection();
    saveDraftValues(fake, "inspection", "i1", { id: "i1", v: "meu" }, 3, now);
    recordConflict(fake, "inspection", { id: "i1" }, { current: {}, collisions: [] });

    rebaseDraft(fake, "i1", { id: "i1", v: "mesclado" }, later);

    expect(drafts.get("i1")).toEqual({
      id: "i1",
      entity: "inspection",
      data: { id: "i1", v: "mesclado" },
      status: "draft",
      step: 3,
      errors: {},
      rebasedAt: later.toISOString(),
      updatedAt: later.toISOString(),
    });
  });

  it("sem passo, apaga, e sem rascunho, nada", () => {
    const { drafts, fake } = collection();
    recordConflict(fake, "client", { id: "c1" }, { current: {}, collisions: [] });

    rebaseDraft(fake, "c1", { id: "c1" });
    rebaseDraft(fake, "x", { id: "x" });

    expect(drafts.size).toBe(0);
  });
});

describe("workingCopy", () => {
  it("só o formulário profundo tem uma cópia de trabalho", () => {
    const { fake } = collection();
    saveDraftValues(fake, "inspection", "i1", { id: "i1", v: "meu" }, 0, now);
    recordRejection(fake, "client", { id: "c1" }, validation({ name: ["Curto."] }));

    expect(workingCopy(fake, "i1")).toEqual({ id: "i1", v: "meu" });
    expect(workingCopy(fake, "c1")).toBeUndefined();
    expect(workingCopy(fake, "x")).toBeUndefined();
  });
});

describe("keepConflictData", () => {
  const conflicted = (data: Record<string, unknown>): DraftRecord => ({
    id: "c1",
    entity: "client",
    data,
    status: "conflict",
    errors: {},
    conflict: { current: { id: "c1", name: "Alfa Negócios", version: "B" }, collisions: [] },
    updatedAt: now.toISOString(),
  });

  it("o formulário salvo em conflito fica no rascunho, que segue em conflito com o current", () => {
    const { drafts, fake } = collection();
    fake.insert(conflicted({ id: "c1", name: "Alfa Imóveis", version: "A" }));

    keepConflictData(fake, "c1", { id: "c1", name: "Alfa Corretora", version: "A" }, later);

    expect(drafts.get("c1")).toMatchObject({
      status: "conflict",
      data: { name: "Alfa Corretora" },
      conflict: { current: { name: "Alfa Negócios" } },
      updatedAt: later.toISOString(),
    });
  });

  it("sem rascunho em conflito, não grava nada", () => {
    const { drafts, fake } = collection();

    keepConflictData(fake, "c1", { id: "c1", name: "Alfa" }, later);

    expect(drafts.size).toBe(0);
  });
});
