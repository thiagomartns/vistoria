import { describe, expect, it } from "vitest";

import { APP_NAME } from "@/shared/app";

describe("APP_NAME", () => {
  it("é o codinome do projeto", () => {
    expect(APP_NAME).toBe("vistoria");
  });
});
