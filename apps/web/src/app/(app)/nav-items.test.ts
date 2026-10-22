// @vitest-environment node

import { describe, expect, it } from "vitest";

import { NAV_ITEMS, navItemFor } from "./nav-items";

describe("navItemFor", () => {
  it.each([
    ["/inspections", "Vistorias"],
    ["/clients", "Clientes"],
    ["/clients/edit", "Clientes"],
    ["/properties", "Imóveis"],
    ["/templates", "Roteiros"],
  ])("%s é de %s", (pathname, label) => {
    expect(navItemFor(pathname)?.label).toBe(label);
  });

  it("não confunde prefixo de nome: /clientsx não é Clientes", () => {
    expect(navItemFor("/clientsx")).toBeUndefined();
  });

  it("os quatro destinos do frame, na ordem", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Vistorias", "Clientes", "Imóveis", "Roteiros"]);
  });
});
