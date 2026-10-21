import { describe, expect, it } from "vitest";

import { newId } from "./ids";

describe("newId", () => {
  it("gera UUID v7 (versão 7, variante RFC 9562)", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("cresce na ordem em que foi gerado", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
