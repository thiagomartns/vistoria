// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Confere, sem executar os pacotes, que cada import citado no mapa Figma → Sanjou existe na versão
// instalada. Uma atualização do Sanjou que renomeie um export quebra aqui, não na primeira tela.

const maps = {
  "docs/architecture/figma-sanjou.md": new URL(
    "../../../../docs/architecture/figma-sanjou.md",
    import.meta.url,
  ),
  "apps/web/CLAUDE.md": new URL("../../CLAUDE.md", import.meta.url),
};

const require = createRequire(import.meta.url);
const sanjouPackageJson = require.resolve("@sanjou/ui/package.json");
const sanjouDir = dirname(sanjouPackageJson);
const sanjouExports = JSON.parse(readFileSync(sanjouPackageJson, "utf8")).exports as Record<
  string,
  { types: string }
>;
// lucide-react é dependência do Sanjou; o app usa a mesma versão.
const lucideDir = dirname(createRequire(sanjouPackageJson).resolve("lucide-react/package.json"));
const lucideTypes = join(
  lucideDir,
  JSON.parse(readFileSync(join(lucideDir, "package.json"), "utf8")).typings,
);

function exportedNames(dtsPath: string): Set<string> {
  const names = new Set<string>();
  for (const [, list = ""] of readFileSync(dtsPath, "utf8").matchAll(/export \{([^}]*)\}/g)) {
    for (const entry of list.split(",")) {
      const name = entry
        .trim()
        .replace(/^type /, "")
        .split(" as ")
        .at(-1)
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function typesOf(from: string): string {
  if (from === "lucide-react") return lucideTypes;
  const subpath = `./${from.slice("@sanjou/ui/".length)}`;
  const entry = sanjouExports[subpath];
  if (!entry) throw new Error(`@sanjou/ui não tem o subpath ${subpath}`);
  return join(sanjouDir, entry.types);
}

function importsIn(markdown: string) {
  return [...markdown.matchAll(/import \{([^}]*)\} from "([^"]+)"/g)]
    .map(([, names = "", from = ""]) => ({ from, names: names.split(",").map((n) => n.trim()) }))
    .filter(({ from }) => from.startsWith("@sanjou/ui/") || from === "lucide-react");
}

describe.each(Object.entries(maps))("mapa Figma → Sanjou em %s", (_, url) => {
  const imports = importsIn(readFileSync(fileURLToPath(url), "utf8"));

  it("cita imports do Sanjou e do lucide-react", () => {
    expect(imports.some(({ from }) => from.startsWith("@sanjou/ui/"))).toBe(true);
    expect(imports.some(({ from }) => from === "lucide-react")).toBe(true);
  });

  it.each(imports.map(({ from, names }) => [from, names] as const))(
    "%s exporta %s",
    (from, names) => {
      const exported = exportedNames(typesOf(from));

      expect(names.filter((name) => !exported.has(name))).toEqual([]);
    },
  );
});
