import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type FieldErrors, useFieldArray, useForm, useFormState, useWatch } from "react-hook-form";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { DraftRecord } from "@/shared/sync/drafts";
import { flatConflictOf } from "@/shared/sync/flat-conflict";
import { newId } from "@/shared/sync/ids";
import { sameValue } from "@/shared/sync/merge";
import { type UnavailableMessages, useFetchMissing } from "@/shared/sync/useFetchMissing";

import { TEMPLATE_ENTITY } from "../models/template";
import {
  ITEMS_MAX,
  type ItemFormValues,
  ROOMS_MAX,
  type RoomFormValues,
  type TemplateFormOutput,
  type TemplateFormValues,
  formPathOf,
  templateErrors,
  templateFormSchema,
} from "../schemas/template.schemas";
import { fetchTemplate, saveTemplate, templateConflictHref } from "../services/templates.sync";
import { type TemplateRow, itemsLabel, templateRowOf } from "../services/templates.view";

/** Para onde o editor volta: a lista. */
export const TEMPLATES_HREF = "/templates";

/** O aviso do rascunho em conflito, acima do formulário (Figma "Roteiros (#173)", estado 6). */
export const CONFLICT_TITLE = "Este roteiro foi alterado em outro aparelho";
export const CONFLICT_DESCRIPTION =
  "Suas alterações estão salvas neste aparelho. Escolha o que fica em cada campo para enviar de novo.";

/** A recusa do servidor (estado 5): o Alert no topo; cada erro volta no seu campo. */
export const REJECTED_TITLE = "O servidor recusou este roteiro";
export const REJECTED_DESCRIPTION = "Corrija o que está marcado e salve de novo.";

/** Sem o registro no aparelho (leitura por id, frontend.md, "Leitura (pull)"). */
export const UNAVAILABLE: UnavailableMessages = {
  offline:
    "Este roteiro ainda não está neste aparelho. Abra-o uma vez com internet para trabalhar nele offline.",
  notFound: "Este roteiro não existe.",
  failed: "Não foi possível buscar este roteiro agora.",
};

/** O nome de um ambiente ainda sem nome, na lista e no cabeçalho. */
export const UNNAMED_ROOM = "Ambiente sem nome";

const valuesOf = (row: TemplateRow): TemplateFormValues => ({
  name: row.name,
  rooms: row.rooms.map((room) => ({
    roomId: room.id,
    name: room.name,
    items: room.items.map((item) => ({ itemId: item.id, name: item.name })),
  })),
});

const newRoom = (): RoomFormValues => ({ roomId: newId(), name: "", items: [] });
const newItem = (): ItemFormValues => ({ itemId: newId(), name: "" });

/** Põe `value` no caminho `keys` (`rooms`, `0`, `items`, `1`, `name`), criando objetos e listas no meio. */
function setPath(target: Record<string, unknown>, keys: string[], value: unknown) {
  let node: Record<string, unknown> = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      node[key] = value;
      return;
    }
    node[key] ??= /^\d+$/.test(keys[index + 1] ?? "") ? [] : {};
    node = node[key] as Record<string, unknown>;
  });
}

// Os erros de um rascunho no formato do react-hook-form, um objeto por rascunho: o `useForm` reaplica `errors`
// sempre que a referência muda, e reaplicar a cada render apagaria a correção que a pessoa está digitando.
const errorsByDraft = new WeakMap<DraftRecord, FieldErrors<TemplateFormValues>>();

function fieldErrorsOf(draft: DraftRecord): FieldErrors<TemplateFormValues> {
  let errors = errorsByDraft.get(draft);
  if (!errors) {
    const built: Record<string, unknown> = {};
    for (const [key, messages] of Object.entries(draft.errors)) {
      const path = formPathOf(key);
      if (path) setPath(built, path.split("."), { type: "server", message: messages[0] });
    }
    errors = built as FieldErrors<TemplateFormValues>;
    errorsByDraft.set(draft, errors);
  }
  return errors;
}

/** Quantos campos com erro cada ambiente tem (o "· 1 correção" da lista de ambientes). */
function correctionsByRoom(errors: FieldErrors<TemplateFormValues>, rooms: number): number[] {
  const counts = Array.from({ length: rooms }, () => 0);
  const roomErrors = Array.isArray(errors.rooms) ? errors.rooms : [];
  roomErrors.forEach((room, index) => {
    if (!room || index >= rooms) return;
    const items: (FieldErrors<ItemFormValues> | undefined)[] = Array.isArray(room.items)
      ? room.items
      : [];
    counts[index] = (room.name ? 1 : 0) + items.filter((item) => item?.name).length;
  });
  return counts;
}

const correctionsLabel = (count: number) => `${count} ${count === 1 ? "correção" : "correções"}`;

/** Um ambiente na lista de ambientes. */
export interface RoomView {
  id: string;
  name: string;
  /** "7 itens", "7 itens · 1 correção". */
  detail: string;
  itemCount: number;
}

/**
 * O editor de /templates/edit: sem `id` cria (com um ambiente vazio para começar), com `id` edita o roteiro do banco
 * local (ou o rascunho que o servidor recusou, com os erros por campo). Os ambientes e os itens são listas do
 * react-hook-form; o ambiente aberto vive só na tela (no desktop, o painel da direita; no celular, o segundo nível).
 * Salvar grava o roteiro inteiro no banco local, enfileira o `PUT` e volta para a lista; só um formulário diferente do
 * registro (ou com recusa a corrigir) vai para a fila (ADR 0028). Com o rascunho em conflito, salvar fica só nele e
 * abre o ConflictResolver.
 */
export function useTemplateForm(id: string | null) {
  const router = useRouter();
  const { store, ready, templates, drafts, states } = useLocalStore();

  const draft = id
    ? drafts.find((candidate) => candidate.id === id && candidate.entity === TEMPLATE_ENTITY)
    : undefined;
  const template = id ? templates.find((candidate) => candidate.id === id) : undefined;
  const row = id ? templateRowOf(template, draft, states.get(id)) : undefined;
  // Um id que o aparelho não tem é buscado no servidor; até chegar, a tela segue carregando.
  const missing = ready && id !== null && !row;
  const { unavailable } = useFetchMissing(
    missing ? id : null,
    store && ((key) => fetchTemplate(store, key)),
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

  const [blank] = useState<TemplateFormValues>(() => ({ name: "", rooms: [newRoom()] }));
  const form = useForm<TemplateFormValues, unknown, TemplateFormOutput>({
    resolver: zodResolver(templateFormSchema, templateErrors),
    defaultValues: blank,
    // O registro entra quando o banco local abre. Se ele mudar por baixo (o pull trouxe outra versão), o que a pessoa
    // já mudou fica, e os erros do servidor também.
    values: row ? valuesOf(row) : undefined,
    resetOptions: { keepDirtyValues: true, keepErrors: true },
    errors: draft ? fieldErrorsOf(draft) : undefined,
  });
  const roomList = useFieldArray({ control: form.control, name: "rooms" });
  const watched = useWatch({ control: form.control, name: "rooms" }) ?? [];
  // A ordem e os ids vêm dos `fields`, que mudam no mesmo render do `append`, do `remove` e do `move`; o `useWatch`
  // chega um render depois, e o painel abriria o ambiente anterior por um instante (o nome digitado logo depois de
  // "Adicionar ambiente" cairia nele). Os nomes e os itens vêm do `useWatch`, pelo id.
  const live = new Map(watched.map((room) => [room.roomId, room]));
  const rooms: RoomFormValues[] = roomList.fields.map(
    (field) =>
      live.get(field.roomId) ?? { roomId: field.roomId, name: field.name, items: field.items },
  );
  const { errors } = useFormState({ control: form.control });

  // O ambiente aberto, pelo id: reordenar não muda qual está aberto. Sem escolha (ou removido), o primeiro.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Celular: o segundo nível (os itens do ambiente aberto). No desktop, os dois painéis aparecem juntos.
  const [open, setOpen] = useState(false);
  // O ambiente com itens esperando a confirmação para sair.
  const [removalId, setRemovalId] = useState<string | null>(null);
  // O ambiente recém-criado, cujo nome ganha o foco assim que o campo aparece.
  const focusId = useRef<string | null>(null);

  const found = rooms.findIndex((room) => room.roomId === selectedId);
  const selected = found === -1 ? 0 : found;
  const corrections = correctionsByRoom(errors, rooms.length);
  const roomViews: RoomView[] = rooms.map((room, index) => ({
    id: room.roomId,
    name: room.name.trim() || UNNAMED_ROOM,
    itemCount: room.items.length,
    detail: [
      itemsLabel(room.items.length),
      corrections[index] ? correctionsLabel(corrections[index]) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const conflictHref = id && flatConflictOf(draft) ? templateConflictHref(id) : null;

  useEffect(() => {
    if (focusId.current === null) return;
    // Pelos ambientes deste render: quando o novo aparece neles, o campo do nome dele já está na tela.
    const index = rooms.findIndex((room) => room.roomId === focusId.current);
    if (index === -1) return;
    form.setFocus(`rooms.${index}.name`);
    focusId.current = null;
  });

  function select(index: number) {
    setSelectedId(rooms[index]?.roomId ?? null);
    setOpen(true);
  }

  function addRoom() {
    if (rooms.length >= ROOMS_MAX) return;
    const room = newRoom();
    roomList.append(room, { shouldFocus: false });
    setSelectedId(room.roomId);
    focusId.current = room.roomId;
    setOpen(true);
  }

  function removeRoom(index: number) {
    const neighbour = rooms[index + 1] ?? rooms[index - 1];
    roomList.remove(index);
    setSelectedId(neighbour?.roomId ?? null);
    setOpen(false);
  }

  const removal = rooms.findIndex((room) => room.roomId === removalId);

  const onSubmit = form.handleSubmit(
    (values) => {
      // Sujo é o que difere do registro de agora, não o `isDirty`: o reset do `values` (o pull trouxe uma versão nova)
      // zera o `isDirty` e deixa o que a pessoa digitou na tela, que sumiria sem ir para a fila (#144).
      const changed = !row || !sameValue(form.getValues(), valuesOf(row));
      if (store && (changed || draft)) {
        saveTemplate(store, { id: id ?? undefined, ...values });
      }
      router.push(conflictHref ?? TEMPLATES_HREF);
    },
    (invalid) => {
      // O erro pode estar num ambiente fechado: abre o primeiro ambiente com erro (o nome do roteiro já está à vista).
      if (invalid.name) return;
      const index = Array.isArray(invalid.rooms) ? invalid.rooms.findIndex(Boolean) : -1;
      if (index !== -1) select(index);
    },
  );

  const rejected = draft?.status === "rejected";
  const unknownErrors = rejected
    ? Object.entries(draft.errors)
        .filter(([key]) => !formPathOf(key))
        .flatMap(([, messages]) => messages)
    : [];

  return {
    status,
    /** Sem o registro: sem rede, não encontrado ou falha do servidor (`RecordUnavailable`). */
    unavailable,
    /** O nome salvo (não o que está sendo digitado), ou "Novo roteiro". */
    title: status === "new" ? "Novo roteiro" : status === "found" && row ? row.name : "Roteiro",
    sync: status === "found" ? row?.sync : undefined,
    form,
    onSubmit,
    rooms: roomViews,
    roomsMax: ROOMS_MAX,
    itemsMax: ITEMS_MAX,
    /** O índice do ambiente aberto. */
    selected,
    /** Celular: o segundo nível está aberto. */
    open,
    select,
    /** Celular: volta aos ambientes, sem perder o que foi digitado. */
    close: () => setOpen(false),
    addRoom,
    moveRoom: (from: number, to: number) => {
      // O aberto é o primeiro quando nada foi escolhido: fixa o id antes de mover, para ele seguir aberto.
      setSelectedId(rooms[selected]?.roomId ?? null);
      roomList.move(from, to);
    },
    /** Remover um ambiente com itens pede confirmação (estado 8); sem itens, sai direto. */
    requestRemoveRoom: (index: number) => {
      if ((rooms[index]?.items.length ?? 0) > 0) setRemovalId(rooms[index]?.roomId ?? null);
      else removeRoom(index);
    },
    removal:
      removal === -1
        ? null
        : { name: roomViews[removal]?.name ?? "", itemCount: roomViews[removal]?.itemCount ?? 0 },
    confirmRemoval: () => {
      if (removal !== -1) removeRoom(removal);
      setRemovalId(null);
    },
    cancelRemoval: () => setRemovalId(null),
    newItem,
    /** O rascunho em conflito: o aviso e o caminho para o ConflictResolver. */
    conflict: conflictHref
      ? { title: CONFLICT_TITLE, description: CONFLICT_DESCRIPTION, href: conflictHref }
      : null,
    /** A recusa do servidor; um erro numa chave que o formulário não tem vai junto da descrição. */
    rejection: rejected
      ? {
          title: REJECTED_TITLE,
          description: [...unknownErrors, REJECTED_DESCRIPTION].join(" "),
        }
      : null,
  };
}
