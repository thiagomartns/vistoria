// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { DraftRecord } from "./drafts";
import { flatConflictGroups, flatConflictOf, resolveFlat } from "./flat-conflict";

// O conflito de um registro plano (cliente, imóvel): o merge refeito a partir do rascunho, as escolhas e os campos
// como o ConflictResolver mostra.

type Record_ = {
  id: string;
  version: string | null;
  name: string;
  email: string | null;
  phone: string | null;
};

const shadow: Record_ = {
  id: "c1",
  version: "A",
  name: "Imobiliária Alfa",
  email: "contato@alfa.com",
  phone: null,
};

// Aqui, nome e telefone; no outro aparelho, nome e e-mail.
const mine: Record_ = { ...shadow, name: "Alfa Imóveis", phone: "(71) 4444-0000" };
const current = {
  ...shadow,
  version: "B",
  name: "Alfa Negócios",
  email: "vendas@alfa.com",
  createdAt: "2026-10-21T00:00:00+00:00",
  updatedAt: "2026-10-27T17:58:00+00:00",
};

function draftOf(over: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: "c1",
    entity: "client",
    data: mine,
    status: "conflict",
    errors: {},
    conflict: { current, base: shadow, collisions: [] },
    updatedAt: "2026-10-27T18:02:00.000Z",
    ...over,
  };
}

describe("flatConflictOf", () => {
  it("refaz o merge com o rascunho de agora: o que só um lado mudou entra, o nome colide", () => {
    const conflict = flatConflictOf<Record_>(draftOf())!;

    expect(conflict.server).toEqual({
      ...shadow,
      version: "B",
      name: "Alfa Negócios",
      email: "vendas@alfa.com",
    });
    expect(conflict.local.version).toBe("B");
    expect(conflict.merged).toEqual({
      ...shadow,
      version: "B",
      name: "Alfa Imóveis",
      email: "vendas@alfa.com",
      phone: "(71) 4444-0000",
    });
    expect(conflict.collisions).toEqual([
      { field: "name", base: "Imobiliária Alfa", local: "Alfa Imóveis", server: "Alfa Negócios" },
    ]);
    expect(conflict.localAt).toBe("2026-10-27T18:02:00.000Z");
    expect(conflict.serverAt).toBe("2026-10-27T17:58:00+00:00");
  });

  it("o rascunho salvo de novo no formulário com o valor do servidor: nada mais colide", () => {
    const conflict = flatConflictOf<Record_>(
      draftOf({ data: { ...mine, name: "Alfa Negócios" } }),
    )!;

    expect(conflict.collisions).toEqual([]);
  });

  it("sem a base, toda diferença colide", () => {
    const conflict = flatConflictOf<Record_>(draftOf({ conflict: { current, collisions: [] } }))!;

    expect(conflict.base).toBeUndefined();
    expect(conflict.collisions.map((collision) => collision.field)).toEqual([
      "name",
      "email",
      "phone",
    ]);
  });

  it("sem conflito ou sem current (deleted): nada a escolher", () => {
    expect(flatConflictOf(undefined)).toBeUndefined();
    expect(flatConflictOf(draftOf({ status: "rejected" }))).toBeUndefined();
    expect(
      flatConflictOf(draftOf({ conflict: { current: undefined, collisions: [] } })),
    ).toBeUndefined();
  });
});

describe("resolveFlat", () => {
  const conflict = flatConflictOf<Record_>(draftOf())!;

  it("'meu' mantém o local, com a version do current", () => {
    expect(resolveFlat(conflict, { name: "meu" })).toEqual({ ...conflict.merged, version: "B" });
  });

  it("'servidor' põe o valor do servidor no campo; o resto mesclado segue", () => {
    expect(resolveFlat(conflict, { name: "servidor" })).toEqual({
      ...shadow,
      version: "B",
      name: "Alfa Negócios",
      email: "vendas@alfa.com",
      phone: "(71) 4444-0000",
    });
  });
});

describe("flatConflictGroups", () => {
  const labels = { name: "Nome", email: "E-mail", phone: "Telefone" };

  it("um grupo só, na ordem do formulário, com 'Antes' e os dois valores", () => {
    const conflict = flatConflictOf<Record_>(draftOf({ conflict: { current, collisions: [] } }))!;
    const withBase = flatConflictOf<Record_>(draftOf({ data: { ...mine, email: "eu@alfa.com" } }))!;

    expect(flatConflictGroups(withBase, { title: "Cliente", labels })).toEqual([
      {
        id: "",
        title: "Cliente",
        fields: [
          {
            key: "name",
            label: "Nome",
            before: "Antes: Imobiliária Alfa",
            mine: "Alfa Imóveis",
            theirs: "Alfa Negócios",
          },
          {
            key: "email",
            label: "E-mail",
            before: "Antes: contato@alfa.com",
            mine: "eu@alfa.com",
            theirs: "vendas@alfa.com",
          },
        ],
      },
    ]);
    expect(
      flatConflictGroups(conflict, { title: "Cliente", labels })[0]!.fields[0]!.before,
    ).toBeNull();
  });

  it("o vazio por extenso ('Antes: sem valor'), e o formato do campo preenchido", () => {
    const conflict = flatConflictOf<Record_>(
      draftOf({
        data: { ...shadow, phone: "71944440000" },
        conflict: { current: { ...current, phone: "71933330000" }, base: shadow, collisions: [] },
      }),
    )!;

    const [group] = flatConflictGroups(conflict, {
      title: "Cliente",
      labels,
      format: (field, value) => (field === "phone" ? `tel ${String(value)}` : String(value)),
      empty: { phone: "Sem telefone" },
    });

    expect(group!.fields).toEqual([
      {
        key: "phone",
        label: "Telefone",
        before: "Antes: sem telefone",
        mine: "tel 71944440000",
        theirs: "tel 71933330000",
      },
    ]);
  });

  it("sem colisão, nenhum grupo", () => {
    const conflict = flatConflictOf<Record_>(
      draftOf({ data: { ...mine, name: "Alfa Negócios" } }),
    )!;

    expect(flatConflictGroups(conflict, { title: "Cliente", labels })).toEqual([]);
  });
});
