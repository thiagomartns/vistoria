import { readFailure } from "@/shared/api/client";
import { type ZipCodeAddressDto, getAddressByZipCode } from "@/shared/api/generated";

// A consulta do endereço pelo CEP (#185, ADR 0067). É só uma ajuda ao formulário: uma leitura, que não passa pela outbox
// e não fica no banco local. A falha não tem reação nenhuma além da dica: o cadastro segue à mão.

/** O endereço que a API achou, no formato do `Property`; o que o provedor não traz vem `null`. */
export type ZipCodeAddress = Omit<ZipCodeAddressDto, "zipCode">;

/**
 * - `found`: o endereço do CEP.
 * - `not-found`: nenhum provedor conhece o CEP (`not-found`).
 * - `failed`: os provedores fora (`upstream-unavailable`), o limite de consultas, a sessão, a rede ou uma resposta
 *   ilegível. Para o formulário, tudo isso é a mesma dica.
 */
export type ZipCodeLookup =
  | { kind: "found"; address: ZipCodeAddress }
  | { kind: "not-found" }
  | { kind: "failed" };

/** Consulta o CEP `zipCode` (8 dígitos, sem máscara) pela API. Nunca lança. */
export async function lookupZipCode(zipCode: string): Promise<ZipCodeLookup> {
  try {
    const result = await getAddressByZipCode({ path: { zipCode } });
    if (result.data !== undefined) {
      const { street, district, city, state } = result.data;
      return { kind: "found", address: { street, district, city, state } };
    }
    const failure = readFailure({ error: result.error, response: result.response });
    // Pelo `type`, nunca pelo status (frontend.md, "Reação aos erros").
    return failure.kind === "problem" && failure.problem.type === "urn:vistoria:problem:not-found"
      ? { kind: "not-found" }
      : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
