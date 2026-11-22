import { useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import {
  type PropertyFormOutput,
  type PropertyFormValues,
  stripZipCode,
} from "../schemas/property.schemas";
import { type ZipCodeAddress, lookupZipCode } from "../services/zip-code";

// O endereço pelo CEP no formulário de imóvel (#185, Figma "CEP no cadastro de imóvel (#185)").

/** As dicas sob o CEP: texto de ajuda (o `FormDescription`), nunca erro de validação, e nenhuma impede salvar. */
export const ZIP_CODE_HINTS = {
  searching: "Buscando endereço…",
  notFound: "CEP não encontrado. Preencha o endereço.",
  failed: "Busca indisponível. Preencha à mão.",
} as const;

type AddressField = keyof ZipCodeAddress;
const ADDRESS_FIELDS: AddressField[] = ["street", "district", "city", "state"];

type Lookup = { zipCode: string; status: "searching" | "found" | "not-found" | "failed" };

/**
 * Consulta o endereço quando a pessoa completa os 8 dígitos do CEP (`onZipCodeChange`, ligado à digitação: abrir um
 * imóvel não consulta). Sem rede, não consulta e não mostra nada. A resposta de um CEP que já mudou é descartada.
 *
 * Troca Rua, Bairro, Cidade e UF que a pessoa não digitou nesta tela: o campo vazio, o que a consulta anterior pôs e
 * ninguém mexeu (corrigir um dígito do CEP troca a cidade errada) e o que veio do registro e ninguém mexeu (na edição,
 * trocar o CEP é dizer que o endereço mudou). O que a pessoa digitou nesta tela nunca é trocado. O que o CEP novo não
 * traz (a rua e o bairro do CEP geral de uma cidade) fica vazio. Se o foco ainda está no CEP, ele vai para a Rua, se
 * ela ficou vazia, ou para o Número.
 */
export function useZipCodeLookup(
  form: UseFormReturn<PropertyFormValues, unknown, PropertyFormOutput>,
) {
  const [lookup, setLookup] = useState<Lookup | null>(null);
  // O CEP da consulta no ar, para descartar a resposta de um CEP que mudou.
  const latest = useRef<string | null>(null);
  // O que a última consulta preencheu, campo a campo.
  const filled = useRef<Partial<Record<AddressField, string>>>({});

  const apply = (address: ZipCodeAddress) => {
    for (const name of ADDRESS_FIELDS) {
      const current = form.getValues(name);
      // O registro carregado é o `defaultValues` do formulário (o `values` do usePropertyForm); no novo, "".
      const saved = form.formState.defaultValues?.[name];
      const ours = current.trim() === "" || current === filled.current[name] || current === saved;
      if (!ours) continue;
      const next = address[name] ?? "";
      if (next === "" && current === "") continue;
      form.setValue(name, next, {
        shouldDirty: true,
        // Tira o "Informe a rua" de um Salvar anterior; sem erro, não valida antes da hora.
        shouldValidate: form.getFieldState(name).invalid,
      });
      if (next === "") delete filled.current[name];
      else filled.current[name] = next;
    }
    if (document.activeElement?.getAttribute("name") === "zipCode") {
      form.setFocus(form.getValues("street").trim() === "" ? "street" : "number");
    }
  };

  const onZipCodeChange = (masked: string) => {
    const zipCode = stripZipCode(masked);
    if (zipCode.length !== 8 || globalThis.navigator?.onLine === false) {
      latest.current = null;
      setLookup(null);
      return;
    }
    if (zipCode === latest.current) return;
    latest.current = zipCode;
    setLookup({ zipCode, status: "searching" });
    void lookupZipCode(zipCode).then((result) => {
      if (latest.current !== zipCode) return;
      latest.current = null;
      if (result.kind === "found") apply(result.address);
      setLookup({ zipCode, status: result.kind });
    });
  };

  const hint =
    lookup?.status === "searching"
      ? ZIP_CODE_HINTS.searching
      : lookup?.status === "not-found"
        ? ZIP_CODE_HINTS.notFound
        : lookup?.status === "failed"
          ? ZIP_CODE_HINTS.failed
          : null;

  return { hint, onZipCodeChange };
}
