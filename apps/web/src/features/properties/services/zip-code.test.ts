// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { getAddressByZipCode } from "@/shared/api/generated";

import { lookupZipCode } from "./zip-code";

vi.mock("@/shared/api/generated", async (original) => ({
  ...(await original<typeof import("@/shared/api/generated")>()),
  getAddressByZipCode: vi.fn<typeof getAddressByZipCode>(),
}));

type Result = Awaited<ReturnType<typeof getAddressByZipCode>>;

// O `error` do client gerado é o corpo lido, que nem sempre é um ProblemDetails (rede, HTML de um 502).
const answer = (result: { data?: unknown; error?: unknown; response?: Response }) =>
  vi.mocked(getAddressByZipCode).mockResolvedValue(result as Result);

const problem = (slug: string, status: number) => ({
  error: {
    type: `urn:vistoria:problem:${slug}`,
    title: "t",
    status,
    detail: "d",
    traceId: "00-trace",
  },
  response: new Response(null, { status }),
});

afterEach(() => vi.mocked(getAddressByZipCode).mockReset());

describe("lookupZipCode", () => {
  it("encontrado: o endereço, sem o CEP", async () => {
    answer({
      data: {
        zipCode: "01310100",
        street: "Avenida Paulista",
        district: "Bela Vista",
        city: "São Paulo",
        state: "SP",
      },
      response: new Response(null, { status: 200 }),
    });

    await expect(lookupZipCode("01310100")).resolves.toEqual({
      kind: "found",
      address: {
        street: "Avenida Paulista",
        district: "Bela Vista",
        city: "São Paulo",
        state: "SP",
      },
    });
    expect(getAddressByZipCode).toHaveBeenCalledWith({ path: { zipCode: "01310100" } });
  });

  it("not-found: nenhum provedor conhece o CEP", async () => {
    answer(problem("not-found", 404));

    await expect(lookupZipCode("99999999")).resolves.toEqual({ kind: "not-found" });
  });

  it.each([
    ["upstream-unavailable", 503],
    ["rate-limited", 429],
    ["unauthorized", 401],
    ["validation", 400],
  ])("%s → failed", async (slug, status) => {
    answer(problem(slug, status));

    await expect(lookupZipCode("01310100")).resolves.toEqual({ kind: "failed" });
  });

  it("sem resposta, resposta ilegível ou exceção → failed", async () => {
    answer({ error: new TypeError("Failed to fetch") });
    await expect(lookupZipCode("01310100")).resolves.toEqual({ kind: "failed" });

    answer({ error: "<html>502</html>", response: new Response(null, { status: 502 }) });
    await expect(lookupZipCode("01310100")).resolves.toEqual({ kind: "failed" });

    vi.mocked(getAddressByZipCode).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(lookupZipCode("01310100")).resolves.toEqual({ kind: "failed" });
  });
});
