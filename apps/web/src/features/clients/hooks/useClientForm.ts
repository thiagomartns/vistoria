import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { type FieldErrors, useForm, useFormState } from "react-hook-form";

import type { DraftRecord } from "@/shared/sync/drafts";

import {
  CLIENT_FIELDS,
  type ClientFormOutput,
  type ClientFormValues,
  clientErrors,
  clientFormSchema,
  formatDocument,
} from "../schemas/client.schemas";
import { saveClient } from "../services/clients.sync";
import { type ClientRow, clientRowOf } from "../services/clients.view";
import { useClientsStore } from "./useClientsStore";

/** Para onde o formulário volta: a lista. */
export const CLIENTS_HREF = "/clients";

/** Erro do servidor numa chave que o formulário não tem. */
export const SERVER_REJECTED = "O servidor recusou este cadastro. Corrija e salve de novo.";

const EMPTY: ClientFormValues = { name: "", document: "", email: "", phone: "" };

const valuesOf = (row: ClientRow): ClientFormValues => ({
  name: row.name,
  document: row.document ? formatDocument(row.document) : "",
  email: row.email ?? "",
  phone: row.phone ?? "",
});

const isField = (key: string): key is (typeof CLIENT_FIELDS)[number] =>
  (CLIENT_FIELDS as readonly string[]).includes(key);

// Os erros de um rascunho no formato do react-hook-form, um objeto por rascunho: o `useForm` reaplica `errors`
// sempre que a referência muda, e reaplicar a cada render apagaria a correção que a pessoa está digitando.
const errorsByDraft = new WeakMap<DraftRecord, FieldErrors<ClientFormValues>>();

function fieldErrorsOf(draft: DraftRecord): FieldErrors<ClientFormValues> {
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
 * O formulário de /clients/edit: sem `id` cria, com `id` edita o client do banco local (ou o rascunho que o servidor
 * recusou, com os erros por campo). Salvar grava no banco local, enfileira o `PUT` e volta para a lista; só um
 * formulário sujo (ou com recusa a corrigir) vai para a fila (ADR 0028).
 */
export function useClientForm(id: string | null) {
  const router = useRouter();
  const { store, ready, clients, drafts, states } = useClientsStore();

  const draft = id ? drafts.find((candidate) => candidate.id === id) : undefined;
  const client = id ? clients.find((candidate) => candidate.id === id) : undefined;
  const row = id ? clientRowOf(client, draft, states.get(id)) : undefined;
  const status = !ready ? "loading" : id === null ? "new" : row ? "found" : "missing";

  const form = useForm<ClientFormValues, unknown, ClientFormOutput>({
    resolver: zodResolver(clientFormSchema, clientErrors),
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
      saveClient(store, {
        id: id ?? undefined,
        name: values.name,
        document: values.document ?? null,
        email: values.email ?? null,
        phone: values.phone ?? null,
      });
    }
    router.push(CLIENTS_HREF);
  });

  return {
    status,
    /** O nome salvo (não o que está sendo digitado), ou "Novo cliente". */
    title: status === "new" ? "Novo cliente" : status === "found" && row ? row.name : "Cliente",
    sync: status === "found" ? row?.sync : undefined,
    form,
    onSubmit,
    /** Recusa do servidor numa chave que o formulário não tem. */
    formError:
      draft && Object.keys(draft.errors).some((key) => !isField(key)) ? SERVER_REJECTED : null,
  };
}
