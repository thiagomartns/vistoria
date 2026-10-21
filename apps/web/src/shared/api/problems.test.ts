// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ProblemDetails, ProblemType } from "./generated";
import { zProblemType } from "./generated/zod.gen";
import { type ReactionGroup, handleProblem } from "./problems";

// A tabela "Reação aos erros" do frontend.md é a especificação: cada type de uma linha tem de cair no grupo dela.

const prefix = "urn:vistoria:problem:";

const groupByName: Record<string, ReactionGroup> = {
  "Tentar de novo": "retry",
  "Renovar sessão": "renew-session",
  "Decisão do usuário": "user-decision",
  "Aceitar o servidor": "accept-server",
  "Voltar ao rascunho": "back-to-draft",
  "Descartar e avisar": "discard-and-warn",
  Bug: "bug",
  Resync: "resync",
  "Remover local": "remove-local",
  "Credencial inválida": "invalid-credentials",
};

function reactionTable(): [ProblemType, string][] {
  const doc = readFileSync(
    new URL("../../../../../docs/architecture/frontend.md", import.meta.url),
    "utf8",
  );
  const lines = doc.split("\n");
  const section = lines.slice(lines.findIndex((line) => line.trim() === "### Reação aos erros"));
  const tableStart = section.findIndex((line) => line.startsWith("|"));
  const tableEnd = section.findIndex((line, i) => i > tableStart && !line.startsWith("|"));
  const rows = section.slice(tableStart + 2, tableEnd); // sem cabeçalho e separador

  return rows.flatMap((row) => {
    const [, group = "", types = ""] = row.split("|").map((cell) => cell.trim());
    return [...types.matchAll(/`([a-z-]+)`/g)].map(
      ([, slug]) => [`${prefix}${slug}` as ProblemType, group] as [ProblemType, string],
    );
  });
}

function problem(type: ProblemType, status: number): ProblemDetails {
  return { type, title: "t", status, detail: "d", traceId: "00-trace" };
}

describe("handleProblem", () => {
  const table = reactionTable();

  it("a tabela cobre todos os type do contrato, uma vez cada", () => {
    const types = table.map(([type]) => type);
    expect(types.toSorted()).toEqual([...zProblemType.options].toSorted());
  });

  it.each(table)("%s → %s", (type, group) => {
    expect(groupByName[group]).toBeDefined();
    expect(handleProblem({ kind: "problem", problem: problem(type, 400) })).toBe(
      groupByName[group],
    );
  });

  it("version-conflict com 409 e com 412 tem a mesma reação", () => {
    const type = `${prefix}version-conflict` as const;
    const on409 = handleProblem({ kind: "problem", problem: problem(type, 409) });
    const on412 = handleProblem({ kind: "problem", problem: problem(type, 412) });
    expect(on409).toBe("user-decision");
    expect(on412).toBe(on409);
  });

  it("decide pelo type, não pelo status", () => {
    const failure = { kind: "problem", problem: problem(`${prefix}validation`, 500) } as const;
    expect(handleProblem(failure)).toBe("back-to-draft");
  });

  it("falha de rede → tentar de novo", () => {
    expect(handleProblem({ kind: "network", cause: new TypeError("fetch failed") })).toBe("retry");
  });

  it("resposta sem ProblemDetails → tentar de novo", () => {
    expect(handleProblem({ kind: "unreadable", status: 502, body: "<html>" })).toBe("retry");
  });
});
