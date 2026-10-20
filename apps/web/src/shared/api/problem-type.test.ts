// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import type { ProblemType } from "./generated";
import { zProblemType } from "./generated/zod.gen";

// O catálogo vem da tabela "Catálogo de erros" do backend.md, a fonte única do contrato. Se a API ganhar
// um type e o gerado não for refeito (ou o contrário), este teste quebra.

const prefix = "urn:vistoria:problem:";

function catalogTypes(): string[] {
  const doc = readFileSync(
    new URL("../../../../../docs/architecture/backend.md", import.meta.url),
    "utf8",
  );
  const lines = doc.split("\n");
  const section = lines.slice(lines.findIndex((line) => line.trim() === "### Catálogo de erros"));
  const tableStart = section.findIndex((line) => line.startsWith("|"));
  const tableEnd = section.findIndex((line, i) => i > tableStart && !line.startsWith("|"));
  const rows = section.slice(tableStart + 2, tableEnd); // sem cabeçalho e separador

  const slugs = new Set<string>();
  for (const row of rows) {
    const slug = /`([a-z-]+)`/.exec(row.split("|")[2] ?? "")?.[1];
    if (slug) slugs.add(`${prefix}${slug}`);
  }
  return [...slugs];
}

describe("ProblemType gerado", () => {
  const catalog = catalogTypes();

  it("tem exatamente os type do catálogo", () => {
    expect(catalog.length).toBeGreaterThan(0);
    expect([...zProblemType.options].toSorted()).toEqual(catalog.toSorted());
  });

  it.each(catalog)("o schema Zod aceita %s", (type) => {
    expect(zProblemType.safeParse(type).success).toBe(true);
  });

  it.each([`${prefix}desconhecido`, "validation", ""])("o schema Zod rejeita %j", (type) => {
    expect(zProblemType.safeParse(type).success).toBe(false);
  });

  it("é a union inferida do schema Zod", () => {
    expectTypeOf<z.infer<typeof zProblemType>>().toEqualTypeOf<ProblemType>();
  });
});
