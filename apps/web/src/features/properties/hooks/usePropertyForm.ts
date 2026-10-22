import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { type FieldErrors, useForm, useFormState } from "react-hook-form";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { DraftRecord } from "@/shared/sync/drafts";

import {
  PROPERTY_FIELDS,
  type PropertyFormOutput,
  TYPE_OPTIONS,
  type PropertyFormValues,
  formatZipCode,
  propertyErrors,
  propertyFormSchema,
} from "../schemas/property.schemas";
import { saveProperty } from "../services/properties.sync";
import { type PropertyRow, clientOptionsOf, propertyRowOf } from "../services/properties.view";

/** Para onde o formulário volta: a lista. */
export const PROPERTIES_HREF = "/properties";

/** Erro do servidor numa chave que o formulário não tem. */
export const SERVER_REJECTED = "O servidor recusou este cadastro. Corrija e salve de novo.";

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
 */
export function usePropertyForm(id: string | null) {
  const router = useRouter();
  const { store, ready, clients, properties, drafts, states } = useLocalStore();

  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const draft = id ? drafts.find((candidate) => candidate.id === id) : undefined;
  const property = id ? properties.find((candidate) => candidate.id === id) : undefined;
  const row = id ? propertyRowOf(property, draft, states.get(id), clientNames) : undefined;
  const status = !ready ? "loading" : id === null ? "new" : row ? "found" : "missing";

  const form = useForm<PropertyFormValues, unknown, PropertyFormOutput>({
    resolver: zodResolver(propertyFormSchema, propertyErrors),
    defaultValues: EMPTY,
    // O registro entra quando o banco local abre. Se ele mudar por baixo (o envio confirmou), o que a pessoa já
    // mudou fica, e os erros do servidor também.
    values: row ? valuesOf(row) : undefined,
    resetOptions: { keepDirtyValues: true, keepErrors: true },
    errors: draft ? fieldErrorsOf(draft) : undefined,
  });
  const { isDirty } = useFormState({ control: form.control });

  const onSubmit = form.handleSubmit((values) => {
    if (store && (isDirty || draft)) {
      saveProperty(store, { id: id ?? undefined, ...values });
    }
    router.push(PROPERTIES_HREF);
  });

  return {
    status,
    /** O endereço salvo (não o que está sendo digitado), ou "Novo imóvel". */
    title: status === "new" ? "Novo imóvel" : status === "found" && row ? row.address : "Imóvel",
    sync: status === "found" ? row?.sync : undefined,
    form,
    onSubmit,
    clientOptions: clientOptionsOf(clients),
    typeOptions: TYPE_OPTIONS,
    /** Recusa do servidor numa chave que o formulário não tem. */
    formError:
      draft && Object.keys(draft.errors).some((key) => !isField(key)) ? SERVER_REJECTED : null,
  };
}
