import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type FieldErrors, useForm } from "react-hook-form";

import { useInspectionImpact } from "@/features/inspections/hooks/useInspectionImpact";
import {
  type EditChange,
  type EditNotice,
  editNotice,
} from "@/features/inspections/services/inspections.view";
import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { DraftRecord } from "@/shared/sync/drafts";
import { flatConflictOf } from "@/shared/sync/flat-conflict";
import { type UnavailableMessages, useFetchMissing } from "@/shared/sync/useFetchMissing";

import {
  PROPERTY_FIELDS,
  type PropertyFormOutput,
  TYPE_OPTIONS,
  type PropertyFormValues,
  formatZipCode,
  maskZipCode,
  propertyErrors,
  propertyFormSchema,
} from "../schemas/property.schemas";
import { fetchProperty, propertyConflictHref, saveProperty } from "../services/properties.sync";
import { type PropertyRow, clientOptionsOf, propertyRowOf } from "../services/properties.view";
import { useZipCodeLookup } from "./useZipCodeLookup";

/** Para onde o formulário volta: a lista. */
export const PROPERTIES_HREF = "/properties";

/** Erro do servidor numa chave que o formulário não tem. */
/** O aviso do rascunho em conflito, acima do formulário (como o estado 5 da tela de campo, Figma 55:5132). */
export const CONFLICT_TITLE = "Este imóvel foi alterado em outro aparelho";
export const CONFLICT_DESCRIPTION =
  "Suas alterações estão salvas neste aparelho. Escolha o que fica em cada campo para enviar de novo.";

/** Sem o registro no aparelho (leitura por id, frontend.md, "Leitura (pull)"). */
export const UNAVAILABLE: UnavailableMessages = {
  offline:
    "Este imóvel ainda não está neste aparelho. Abra-o uma vez com internet para trabalhar nele offline.",
  notFound: "Este imóvel não existe ou foi excluído.",
  failed: "Não foi possível buscar este imóvel agora.",
};

export const SERVER_REJECTED = "O servidor recusou este cadastro. Corrija e salve de novo.";

const PROPERTY_MASKS = { zipCode: maskZipCode };

const EMPTY: PropertyFormValues = {
  clientId: "",
  type: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  notes: "",
};

const valuesOf = (row: PropertyRow): PropertyFormValues => ({
  clientId: row.clientId,
  type: row.type ?? "",
  zipCode: formatZipCode(row.zipCode),
  street: row.street,
  number: row.number,
  complement: row.complement ?? "",
  district: row.district,
  city: row.city,
  state: row.state,
  notes: row.notes ?? "",
});

/** O formulário tem algo diferente de `saved`, campo a campo. */
const differs = (values: PropertyFormValues, saved: PropertyFormValues) =>
  (Object.keys(saved) as (keyof PropertyFormValues)[]).some((key) => values[key] !== saved[key]);

/** Os campos do endereço, que vão no laudo (#234). */
const ADDRESS_FIELDS = [
  "zipCode",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
] as const satisfies readonly (keyof PropertyFormValues)[];

/**
 * O que mudou do que vai no laudo (#234): só o endereço, ou também o tipo ou o cliente (`data`). `null` quando só as
 * observações mudaram, e o formulário salva sem aviso.
 */
function changeOf(values: PropertyFormValues, saved: PropertyFormValues): EditChange | null {
  if (values.type !== saved.type || values.clientId !== saved.clientId) return "data";
  return ADDRESS_FIELDS.some((key) => values[key] !== saved[key]) ? "address" : null;
}

const isField = (key: string): key is (typeof PROPERTY_FIELDS)[number] =>
  (PROPERTY_FIELDS as readonly string[]).includes(key);

// Os erros de um rascunho no formato do react-hook-form, um objeto por rascunho: o `useForm` reaplica `errors`
// sempre que a referência muda, e reaplicar a cada render apagaria a correção que a pessoa está digitando.
const errorsByDraft = new WeakMap<DraftRecord, FieldErrors<PropertyFormValues>>();

function fieldErrorsOf(draft: DraftRecord): FieldErrors<PropertyFormValues> {
  let errors = errorsByDraft.get(draft);
  if (!errors) {
    errors = {};
    for (const [key, messages] of Object.entries(draft.errors)) {
      if (isField(key)) errors[key] = { type: "server", message: messages[0] };
    }
    errorsByDraft.set(draft, errors);
  }
  return errors;
}

/**
 * O formulário de /properties/edit: sem `id` cria, com `id` edita o imóvel do banco local (ou o rascunho que o
 * servidor recusou, com os erros por campo). O cliente se escolhe entre os do aparelho. Salvar grava no banco local,
 * enfileira o `PUT` e volta para a lista; só um formulário sujo (ou com recusa a corrigir) vai para a fila (ADR 0028).
 * Com o rascunho em conflito, salvar fica só nele e abre o ConflictResolver.
 */
export function usePropertyForm(id: string | null) {
  const router = useRouter();
  const { store, ready, clients, properties, drafts, states } = useLocalStore();

  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const draft = id ? drafts.find((candidate) => candidate.id === id) : undefined;
  const property = id ? properties.find((candidate) => candidate.id === id) : undefined;
  const row = id ? propertyRowOf(property, draft, states.get(id), clientNames) : undefined;
  // Um id que o aparelho não tem é buscado no servidor; até chegar, a tela segue carregando.
  const missing = ready && id !== null && !row;
  const { unavailable } = useFetchMissing(
    missing ? id : null,
    store && ((key) => fetchProperty(store, key)),
    UNAVAILABLE,
  );
  const status = !ready
    ? "loading"
    : id === null
      ? "new"
      : row
        ? "found"
        : unavailable
          ? "unavailable"
          : "loading";

  const form = useForm<PropertyFormValues, unknown, PropertyFormOutput>({
    resolver: zodResolver(propertyFormSchema, propertyErrors),
    defaultValues: EMPTY,
    // O registro entra quando o banco local abre. Se ele mudar por baixo (o envio confirmou), o que a pessoa já
    // mudou fica, e os erros do servidor também.
    values: row ? valuesOf(row) : undefined,
    resetOptions: { keepDirtyValues: true, keepErrors: true },
    errors: draft ? fieldErrorsOf(draft) : undefined,
  });

  // O endereço pelo CEP (#185): uma ajuda, fora da outbox.
  const zipCode = useZipCodeLookup(form);

  // Em conflito, salvar guarda o formulário só no rascunho (saveProperty) e leva ao ConflictResolver, que parte dele.
  const conflictHref = id && flatConflictOf(draft) ? propertyConflictHref(id) : null;

  // As vistorias do imóvel, para o aviso ao salvar (#234). O imóvel novo não tem.
  const impact = useInspectionImpact(id && row ? [id] : null);
  const [confirming, setConfirming] = useState<{
    notice: EditNotice;
    values: PropertyFormOutput;
  } | null>(null);

  const save = (values: PropertyFormOutput) => {
    // Sujo é o que difere do registro de agora, não o `isDirty`: o reset do `values` (o pull trouxe uma versão nova)
    // zera o `isDirty` e deixa o que a pessoa digitou na tela, que sumiria sem ir para a fila (#144).
    const changed = !row || differs(form.getValues(), valuesOf(row));
    if (store && (changed || draft)) {
      saveProperty(store, { id: id ?? undefined, ...values });
    }
    router.push(conflictHref ?? PROPERTIES_HREF);
  };

  const onSubmit = form.handleSubmit((values) => {
    // Com vistorias, mudar o que vai no laudo pede o aviso antes (#234). Em conflito, salvar fica só no rascunho e
    // leva ao ConflictResolver, sem aviso.
    const notice =
      row && impact && !conflictHref
        ? editNotice(impact, "property", changeOf(form.getValues(), valuesOf(row)))
        : null;
    if (notice) setConfirming({ notice, values });
    else save(values);
  });

  return {
    status,
    /** Sem o registro: sem rede, não encontrado ou falha do servidor (`RecordUnavailable`). */
    unavailable,
    /** O endereço salvo (não o que está sendo digitado), ou "Novo imóvel". */
    title: status === "new" ? "Novo imóvel" : status === "found" && row ? row.address : "Imóvel",
    sync: status === "found" ? row?.sync : undefined,
    form,
    onSubmit,
    clientOptions: clientOptionsOf(clients),
    typeOptions: TYPE_OPTIONS,
    /** As máscaras ao digitar (ADR 0063); o schema as tira ao salvar. */
    masks: PROPERTY_MASKS,
    /** A dica sob o CEP, da consulta do endereço (#185), ou `null`. */
    zipCodeHint: zipCode.hint,
    /** A digitação no CEP, que consulta o endereço ao completar os 8 dígitos. */
    onZipCodeChange: zipCode.onZipCodeChange,
    /** O rascunho em conflito: o aviso e o caminho para o ConflictResolver. */
    conflict: conflictHref
      ? { title: CONFLICT_TITLE, description: CONFLICT_DESCRIPTION, href: conflictHref }
      : null,
    /** Recusa do servidor numa chave que o formulário não tem. */
    formError:
      draft && Object.keys(draft.errors).some((key) => !isField(key)) ? SERVER_REJECTED : null,
    /** O aviso ao salvar um imóvel com vistorias (#234): "Salvar" grava, "Voltar" fecha sem salvar. */
    saveNotice: {
      notice: confirming?.notice ?? null,
      onConfirm: () => {
        if (confirming) save(confirming.values);
        setConfirming(null);
      },
      onCancel: () => setConfirming(null),
    },
  };
}
