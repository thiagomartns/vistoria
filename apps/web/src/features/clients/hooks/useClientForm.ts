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
  CLIENT_FIELDS,
  type ClientFormOutput,
  type ClientFormValues,
  clientErrors,
  clientFormSchema,
  formatDocument,
  formatPhone,
  maskDocument,
  maskPhone,
} from "../schemas/client.schemas";
import { fetchClient, clientConflictHref, saveClient } from "../services/clients.sync";
import { type ClientRow, clientRowOf } from "../services/clients.view";

/** Para onde o formulário volta: a lista. */
export const CLIENTS_HREF = "/clients";

/** Erro do servidor numa chave que o formulário não tem. */
/** O aviso do rascunho em conflito, acima do formulário (como o estado 5 da tela de campo, Figma 55:5132). */
export const CONFLICT_TITLE = "Este cliente foi alterado em outro aparelho";
export const CONFLICT_DESCRIPTION =
  "Suas alterações estão salvas neste aparelho. Escolha o que fica em cada campo para enviar de novo.";

/** Sem o registro no aparelho (leitura por id, frontend.md, "Leitura (pull)"). */
export const UNAVAILABLE: UnavailableMessages = {
  offline:
    "Este cliente ainda não está neste aparelho. Abra-o uma vez com internet para trabalhar nele offline.",
  notFound: "Este cliente não existe ou foi excluído.",
  failed: "Não foi possível buscar este cliente agora.",
};

export const SERVER_REJECTED = "O servidor recusou este cadastro. Corrija e salve de novo.";

const CLIENT_MASKS = { document: maskDocument, phone: maskPhone };

const EMPTY: ClientFormValues = { name: "", document: "", email: "", phone: "" };

const valuesOf = (row: ClientRow): ClientFormValues => ({
  name: row.name,
  document: row.document ? formatDocument(row.document) : "",
  email: row.email ?? "",
  phone: row.phone ? formatPhone(row.phone) : "",
});

/** O formulário tem algo diferente de `saved`, campo a campo. */
const differs = (values: ClientFormValues, saved: ClientFormValues) =>
  (Object.keys(saved) as (keyof ClientFormValues)[]).some((key) => values[key] !== saved[key]);

/**
 * O que mudou do que vai no laudo (#234): o nome, o documento ou os dois (`data`). `null` quando só o e-mail ou o
 * telefone mudaram, e o formulário salva sem aviso.
 */
function changeOf(values: ClientFormValues, saved: ClientFormValues): EditChange | null {
  const name = values.name !== saved.name;
  const document = values.document !== saved.document;
  return name && document ? "data" : name ? "name" : document ? "document" : null;
}

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
 * formulário sujo (ou com recusa a corrigir) vai para a fila (ADR 0028). Com o rascunho em conflito, salvar fica só
 * nele e abre o ConflictResolver.
 */
export function useClientForm(id: string | null) {
  const router = useRouter();
  const { store, ready, clients, properties, drafts, states } = useLocalStore();

  const draft = id ? drafts.find((candidate) => candidate.id === id) : undefined;
  const client = id ? clients.find((candidate) => candidate.id === id) : undefined;
  const row = id ? clientRowOf(client, draft, states.get(id)) : undefined;
  // Um id que o aparelho não tem é buscado no servidor; até chegar, a tela segue carregando.
  const missing = ready && id !== null && !row;
  const { unavailable } = useFetchMissing(
    missing ? id : null,
    store && ((key) => fetchClient(store, key)),
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

  const form = useForm<ClientFormValues, unknown, ClientFormOutput>({
    resolver: zodResolver(clientFormSchema, clientErrors),
    defaultValues: EMPTY,
    // O registro entra quando o banco local abre. Se ele mudar por baixo (o envio confirmou), o que a pessoa já
    // mudou fica, e os erros do servidor também.
    values: row ? valuesOf(row) : undefined,
    resetOptions: { keepDirtyValues: true, keepErrors: true },
    errors: draft ? fieldErrorsOf(draft) : undefined,
  });

  // Em conflito, salvar guarda o formulário só no rascunho (saveClient) e leva ao ConflictResolver, que parte dele.
  const conflictHref = id && flatConflictOf(draft) ? clientConflictHref(id) : null;

  // As vistorias dos imóveis do cliente, para o aviso ao salvar (#234). O cliente novo não tem.
  const propertyIds =
    id && row
      ? properties.filter((property) => property.clientId === id).map((property) => property.id)
      : null;
  const impact = useInspectionImpact(propertyIds);
  const [confirming, setConfirming] = useState<{
    notice: EditNotice;
    values: ClientFormOutput;
  } | null>(null);

  const save = (values: ClientFormOutput) => {
    // Sujo é o que difere do registro de agora, não o `isDirty`: o reset do `values` (o pull trouxe uma versão nova)
    // zera o `isDirty` e deixa o que a pessoa digitou na tela, que sumiria sem ir para a fila (#144).
    const changed = !row || differs(form.getValues(), valuesOf(row));
    if (store && (changed || draft)) {
      saveClient(store, {
        id: id ?? undefined,
        name: values.name,
        document: values.document ?? null,
        email: values.email ?? null,
        phone: values.phone ?? null,
      });
    }
    router.push(conflictHref ?? CLIENTS_HREF);
  };

  const onSubmit = form.handleSubmit((values) => {
    // Com vistorias, mudar o que vai no laudo pede o aviso antes (#234). Em conflito, salvar fica só no rascunho e
    // leva ao ConflictResolver, sem aviso.
    const notice =
      row && impact && !conflictHref
        ? editNotice(impact, "client", changeOf(form.getValues(), valuesOf(row)))
        : null;
    if (notice) setConfirming({ notice, values });
    else save(values);
  });

  return {
    status,
    /** Sem o registro: sem rede, não encontrado ou falha do servidor (`RecordUnavailable`). */
    unavailable,
    /** O nome salvo (não o que está sendo digitado), ou "Novo cliente". */
    title: status === "new" ? "Novo cliente" : status === "found" && row ? row.name : "Cliente",
    sync: status === "found" ? row?.sync : undefined,
    form,
    onSubmit,
    /** As máscaras ao digitar (ADR 0063); o schema as tira ao salvar. */
    masks: CLIENT_MASKS,
    /** O rascunho em conflito: o aviso e o caminho para o ConflictResolver. */
    conflict: conflictHref
      ? { title: CONFLICT_TITLE, description: CONFLICT_DESCRIPTION, href: conflictHref }
      : null,
    /** Recusa do servidor numa chave que o formulário não tem. */
    formError:
      draft && Object.keys(draft.errors).some((key) => !isField(key)) ? SERVER_REJECTED : null,
    /** O aviso ao salvar um cliente com vistorias (#234): "Salvar" grava, "Voltar" fecha sem salvar. */
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
