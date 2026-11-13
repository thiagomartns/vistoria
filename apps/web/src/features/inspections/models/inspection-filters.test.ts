// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  NO_FILTERS,
  activeFilterCount,
  filtersFromParams,
  filtersToSearch,
  isFiltered,
} from "./inspection-filters";

// Os filtros da lista na URL (#175): o "Voltar" da tela de campo e do laudo devolve a lista filtrada.

describe("filtros na URL", () => {
  it("ida e volta: o que sai na URL volta igual", () => {
    const filters = {
      query: "Rua das Flores",
      clientId: "c1",
      propertyId: "p1",
      kind: "moveOut" as const,
      status: "completed" as const,
      period: "30d" as const,
    };

    const search = filtersToSearch(filters);

    expect(search).toBe(
      "q=Rua+das+Flores&cliente=c1&imovel=p1&tipo=moveOut&status=completed&periodo=30d",
    );
    expect(filtersFromParams(new URLSearchParams(search))).toEqual(filters);
  });

  it("sem filtro, a URL fica sem query string", () => {
    expect(filtersToSearch(NO_FILTERS)).toBe("");
    expect(filtersFromParams(new URLSearchParams())).toEqual(NO_FILTERS);
  });

  it("valor que não existe vira 'todos'", () => {
    expect(
      filtersFromParams(
        new URLSearchParams("tipo=vistoria&status=aberta&periodo=1h&cliente=&imovel="),
      ),
    ).toEqual(NO_FILTERS);
  });

  it("conta os filtros ligados, sem a busca; a busca só com espaço não filtra", () => {
    expect(
      activeFilterCount({ ...NO_FILTERS, query: "flores", kind: "moveIn", period: "7d" }),
    ).toBe(2);
    expect(isFiltered({ ...NO_FILTERS, query: "   " })).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, query: "flores" })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, status: "completed" })).toBe(true);
  });
});
