import { describe, expect, it } from "vitest";

import { backHrefOf, withBack } from "./useInspections";

// O "Voltar" da tela de campo e do laudo (#176): o `?voltar=` só vale com um caminho deste app.

describe("backHrefOf", () => {
  it("um caminho do app vale; sem parâmetro, a lista", () => {
    expect(backHrefOf("/properties/edit?id=p1&tab=vistorias")).toBe("/properties/edit?id=p1&tab=vistorias");
    expect(backHrefOf(null)).toBe("/inspections");
    expect(backHrefOf("")).toBe("/inspections");
  });

  it("outro host, protocolo ou caminho relativo não vale: a lista", () => {
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "properties"]) {
      expect(backHrefOf(value)).toBe("/inspections");
    }
  });
});

describe("withBack", () => {
  it("acrescenta o `voltar` codificado, com & ou ? conforme o href", () => {
    expect(withBack("/inspections/edit?id=i1", "/properties/edit?id=p1&tab=vistorias")).toBe(
      "/inspections/edit?id=i1&voltar=%2Fproperties%2Fedit%3Fid%3Dp1%26tab%3Dvistorias",
    );
    expect(withBack("/inspections", "/a")).toBe("/inspections?voltar=%2Fa");
  });
});
