import { describe, expect, it } from "vitest";

import { LIST_PAGE_SIZE, countLabel } from "./list-page";

const IMOVEL = { one: "imóvel", many: "imóveis" };

describe("countLabel", () => {
  it("diz o total, no singular ou no plural, e quantos estão na lista quando ela está cortada", () => {
    expect(countLabel(1, 1, IMOVEL)).toBe("1 imóvel");
    expect(countLabel(12, 12, IMOVEL)).toBe("12 imóveis");
    expect(countLabel(0, 0, IMOVEL)).toBe("0 imóveis");
    expect(countLabel(LIST_PAGE_SIZE, 2_500, IMOVEL)).toBe("50 de 2.500 imóveis");
    expect(countLabel(1_050, 2_500, { one: "cliente", many: "clientes" })).toBe(
      "1.050 de 2.500 clientes",
    );
  });
});
