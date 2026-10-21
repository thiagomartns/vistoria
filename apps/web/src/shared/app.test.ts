import { describe, expect, it } from "vitest";

import { APP_NAME, APP_TITLE } from "@/shared/app";

describe("APP_NAME", () => {
  it("é o nome exibido, não o técnico", () => {
    expect(APP_NAME).toBe("Avis");
  });
});

describe("APP_TITLE", () => {
  it('dá "Avis" na home e "%s · Avis" nas outras páginas', () => {
    expect(APP_TITLE).toEqual({ default: "Avis", template: "%s · Avis" });
  });
});
