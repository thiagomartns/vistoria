// @vitest-environment node

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

// Prova o critério "um type novo quebra o pnpm typecheck": compila uma cópia do problems.ts contra um
// generated/ falso cujo ProblemType ganhou um membro, com o tsc do web.

const problemsFile = fileURLToPath(new URL("./problems.ts", import.meta.url));
const generatedTypes = fileURLToPath(new URL("./generated/types.gen", import.meta.url));
const tsc = fileURLToPath(new URL("../../../node_modules/.bin/tsc", import.meta.url));

const dirs: string[] = [];

function typecheck(extraType: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "problems-typecheck-"));
  dirs.push(dir);
  copyFileSync(problemsFile, join(dir, "problems.ts"));
  mkdirSync(join(dir, "generated"));
  const union = extraType ? ` | "${extraType}"` : "";
  writeFileSync(
    join(dir, "generated", "index.ts"),
    [
      `import type * as real from ${JSON.stringify(generatedTypes)};`,
      `export type ProblemType = real.ProblemType${union};`,
      `export type ProblemDetails = real.ProblemDetails;`,
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "esnext"],
        strict: true,
        noEmit: true,
        module: "esnext",
        moduleResolution: "bundler",
        skipLibCheck: true,
        verbatimModuleSyntax: true,
      },
      files: ["problems.ts"],
    }),
  );
  const result = spawnSync(tsc, ["-p", dir], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("switch exaustivo do handleProblem", () => {
  it("compila com o ProblemType atual (controle)", () => {
    const { status, output } = typecheck(null);
    expect(output).toBe("");
    expect(status).toBe(0);
  });

  it("um type novo no contrato quebra o typecheck", () => {
    const { status, output } = typecheck("urn:vistoria:problem:novo");
    expect(status).not.toBe(0);
    expect(output).toMatch(/problems\.ts.*error TS\d+/);
  });
});
