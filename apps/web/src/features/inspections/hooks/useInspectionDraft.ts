import { useEffect, useRef, useState } from "react";
import { type FieldErrors, type FieldPath, useForm, useFormState, useWatch } from "react-hook-form";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { FieldSyncState } from "@/shared/components/field-sync-indicator";
import type { SyncBadgeState } from "@/shared/components/sync-badge";
import type { DraftRecord } from "@/shared/sync/drafts";

import { INSPECTION_ENTITY, type InspectionRecord } from "../models/inspection";
import {
  CONDITIONS,
  CONDITION_VALUES,
  type InspectionFormValues,
  NOTES_MAX,
  formPathOf,
  formValuesOf,
  recordWith,
  roomOfError,
  roomStepSchema,
} from "../schemas/inspection.schemas";
import { conflictHref, inspectionConflictOf } from "../services/inspections.resolve";
import { saveInspection, saveInspectionDraft } from "../services/inspections.sync";
import {
  conflictPlaces,
  fieldHeader,
  pendingItemIds,
  roomViews,
  roomsSummary,
} from "../services/inspections.view";
import { placesOf } from "./useInspections";

/** Depois da última mudança, o rascunho é gravado; fechar a aba depois disso não perde nada. */
export const DRAFT_DEBOUNCE_MS = 300;
/** Depois da última mudança, a vistoria vai para a fila (e também ao trocar de ambiente ou sair da tela). */
export const QUEUE_DEBOUNCE_MS = 1500;

export const REJECTED_TITLE = "O servidor recusou esta vistoria";

/** O aviso do estado 5 (Figma 55:5132). */
export const CONFLICT_TITLE = "Esta vistoria foi alterada em outro aparelho";
export const CONFLICT_DESCRIPTION =
  "Suas alterações estão salvas neste aparelho. Escolha o que fica em cada campo para enviar de novo.";

type Values = Omit<InspectionRecord, "version">;
type ItemPath = FieldPath<InspectionFormValues>;

const withoutVersion = ({ version: _version, ...rest }: InspectionRecord): Values => rest;

/** A vistoria sem nenhum item avaliado: a base de uma criação que só existe no rascunho. */
const emptied = (record: InspectionRecord): InspectionRecord => ({
  ...record,
  rooms: record.rooms.map((room) => ({
    ...room,
    items: room.items.map((item) => ({ ...item, condition: null, notes: null })),
  })),
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** As chaves `rooms[r].items[i].campo` dos erros que o formulário tem agora (os do servidor e os do Próximo). */
function errorKeys(errors: FieldErrors<InspectionFormValues>): Record<string, string[]> {
  const keys: Record<string, string[]> = {};
  const rooms = Array.isArray(errors.rooms) ? errors.rooms : [];
  rooms.forEach((room, r) => {
    const items: (
      | FieldErrors<InspectionFormValues["rooms"][number]["items"][number]>
      | undefined
    )[] = Array.isArray(room?.items) ? room.items : [];
    items.forEach((item, i) => {
      for (const field of ["condition", "notes"] as const) {
        const message = item?.[field]?.message;
        if (message) keys[`rooms[${r}].items[${i}].${field}`] = [message];
      }
    });
  });
  return keys;
}

/** O passo em que a tela abre: o ambiente do primeiro erro de um rascunho recusado, ou o que ficou no rascunho. */
function initialStep(draft: DraftRecord | undefined, rooms: number): number {
  const errorRooms = Object.keys(draft?.status === "rejected" ? draft.errors : {})
    .map(roomOfError)
    .filter((room) => room !== undefined);
  const step = errorRooms.length > 0 ? Math.min(...errorRooms) : (draft?.step ?? 0);
  return Math.max(0, Math.min(step, rooms - 1));
}

/**
 * O ciclo de vida da tela de campo (frontend.md, "Formulários profundos"; ADR 0021 e 0036).
 *
 * - Abre uma vez: o registro local é a base (`defaultValues`) e o rascunho vem por cima, então o formulário já abre
 *   sujo se a aba fechou com uma mudança que não chegou à fila. Um rascunho recusado reabre com os erros do servidor,
 *   convertidos para o caminho do formulário, no ambiente do primeiro erro.
 * - Cada mudança vai para o rascunho (valores e ambiente) logo depois de digitar, e para a fila um pouco depois, ao
 *   trocar de ambiente e ao sair da tela. Só um formulário sujo vai para a fila (ADR 0028); a compactação da outbox
 *   junta o que ainda não saiu.
 * - Fica só leitura enquanto o envio da vistoria está no ar.
 * - Em conflito (estado 5), segue editável, mas o que a pessoa marca fica só no rascunho: o envio sai pelo
 *   ConflictResolver, que parte dele. Enfileirar levaria a versão de antes do conflito, e o 412 voltaria a cada mudança.
 */
export function useInspectionDraft(id: string | null) {
  const { store, ready, inspections, properties, clients, drafts, states, bases } = useLocalStore();

  const record = id ? inspections.find((candidate) => candidate.id === id) : undefined;
  const draft = id
    ? drafts.find((candidate) => candidate.id === id && candidate.entity === INSPECTION_ENTITY)
    : undefined;
  // A vistoria que a tela mostra: o rascunho tem o mais novo (numa criação recusada, é o único lugar onde ela existe).
  const source = (draft?.data as InspectionRecord | undefined) ?? record;
  const status = !ready ? "loading" : !id || !source ? "missing" : "found";
  const inConflict = draft?.status === "conflict";

  const form = useForm<InspectionFormValues>({ defaultValues: { rooms: [] } });
  const watched = useWatch({ control: form.control }) as InspectionFormValues;
  const { isDirty, errors } = useFormState({ control: form.control });
  const [step, setStep] = useState(0);
  // A vistoria aberta: troca no render em que o banco local a entrega, e o passo inicial vem junto.
  const [opened, setOpened] = useState<string | null>(null);
  if (status === "found" && source && id && opened !== id) {
    setOpened(id);
    setStep(initialStep(draft, source.rooms.length));
  }
  const hydrated = status === "found" && opened === id;

  // O formulário abre uma vez por vistoria. A base é o que está na fila (ou confirmado); numa criação recusada não há
  // registro, e a base é a vistoria sem nada avaliado. O rascunho vem por cima e deixa o formulário sujo se ele tem algo
  // que não chegou à fila.
  const opening = useRef({ record, draft, source });
  useEffect(() => {
    opening.current = { record, draft, source };
  });
  /** Os valores com que a tela abriu: uma recusa só volta para a fila depois de a pessoa mudar algo. */
  const openedWith = useRef<string | null>(null);
  /** O `rebasedAt` do rascunho que o formulário já mostra. */
  const rebased = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!opened) return;
    const { record: base, draft: saved, source: shown } = opening.current;
    if (!shown) return;
    form.reset(formValuesOf(base ?? emptied(shown)));
    if (saved)
      form.reset(formValuesOf(saved.data as InspectionRecord), { keepDefaultValues: true });
    openedWith.current = JSON.stringify(form.getValues());
    rebased.current = saved?.rebasedAt;
  }, [opened, form]);

  // Um merge sem colisão regravou o rascunho e já foi para a fila: o formulário passa a mostrar o mesclado, limpo. Sem
  // isso, o próximo envio levaria os valores de antes por cima do que veio do servidor. Nada digitado se perde: o merge
  // acontece com o envio no ar, e o formulário fica só leitura (ADR 0021).
  const rebasedAt = draft?.rebasedAt;
  useEffect(() => {
    if (!hydrated || rebased.current === rebasedAt) return;
    rebased.current = rebasedAt;
    const saved = opening.current.draft;
    if (saved) form.reset(formValuesOf(saved.data as InspectionRecord));
  }, [hydrated, rebasedAt, form]);

  // Os erros de um rascunho recusado vão para os campos na abertura e quando uma recusa chega com a tela aberta; uma
  // vez por recusa, para não voltar a marcar o que a pessoa já corrigiu.
  const rejected = draft?.status === "rejected" ? draft.errors : null;
  const rejectedKey = rejected ? JSON.stringify(rejected) : null;
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || applied.current === rejectedKey) return;
    applied.current = rejectedKey;
    for (const [key, messages] of Object.entries(
      rejectedKey ? (JSON.parse(rejectedKey) as Record<string, string[]>) : {},
    )) {
      const path = formPathOf(key);
      if (path) form.setError(path, { type: "server", message: messages[0] });
    }
  }, [hydrated, rejectedKey, form]);
  /** Erros do servidor em chaves que o formulário não tem (o imóvel, por exemplo). */
  const outsideErrors = Object.entries(rejected ?? {})
    .filter(([key]) => !formPathOf(key))
    .map(([key, messages]) => messages[0] ?? key);

  const current: Values | undefined =
    hydrated && source ? withoutVersion(recordWith(source, watched)) : undefined;

  const [enqueued, setEnqueued] = useState<{
    base: Record<string, unknown> | undefined;
    version: string | null;
  } | null>(null);
  const baseNow = id && bases.has(id) ? bases.get(id) : enqueued ? enqueued.base : record;

  /**
   * Grava o rascunho (valores e ambiente) e, se pedido e o formulário está sujo, põe a vistoria na fila. Um rascunho
   * recusado reabre sujo (o otimista foi desfeito), mas só volta para a fila quando a pessoa muda algo: reenviar sozinho
   * apagaria os erros antes da correção.
   */
  function persist(values: InspectionFormValues, at: number, enqueue: boolean) {
    if (!store || !hydrated || !source) return;
    const next = withoutVersion(recordWith(source, values));
    saveInspectionDraft(store, next, at);
    const untouchedRejection = rejected !== null && JSON.stringify(values) === openedWith.current;
    if (enqueue && isDirty && !untouchedRejection && !inConflict) {
      setEnqueued({ base: baseNow, version: record?.version ?? null });
      saveInspection(store, next);
      form.reset(values);
    }
  }

  // Os temporizadores chamam o `persist` do render mais recente (store, registro e rascunho de agora).
  const latest = useRef(persist);
  useEffect(() => {
    latest.current = persist;
  });

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => latest.current(watched, step, false), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, watched, step]);

  useEffect(() => {
    if (!hydrated || !isDirty) return;
    const timer = setTimeout(() => latest.current(watched, step, true), QUEUE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, isDirty, watched, step]);

  // Sair da tela ou fechar a aba manda para a fila o que estiver sujo, sem esperar o debounce.
  const stepNow = useRef(step);
  useEffect(() => {
    stepNow.current = step;
  }, [step]);
  useEffect(() => {
    const flush = () => latest.current(form.getValues(), stepNow.current, true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [form]);

  // Em conflito, o merge refeito com o rascunho de agora diz quais ambientes e itens estão em disputa.
  const conflict = inspectionConflictOf(draft);
  const disputed = conflictPlaces(conflict);
  const rooms = current ? roomViews(current.rooms, errorKeys(errors), disputed.rooms) : [];
  const room = current?.rooms[step];
  const sending = id ? states.get(id) === "enviando" : false;

  /**
   * Vai para outro ambiente. Avançar confere o ambiente atual (roomStepSchema) sem bloquear: o que estiver errado fica
   * marcado na etapa.
   */
  function goTo(index: number) {
    if (!current || index < 0 || index >= current.rooms.length) return;
    if (index > step) {
      const result = roomStepSchema.safeParse(form.getValues(`rooms.${step}`));
      for (const issue of result.error?.issues ?? []) {
        const [, item, field] = issue.path;
        form.setError(`rooms.${step}.items.${Number(item)}.${String(field)}` as ItemPath, {
          type: "step",
          message: issue.message,
        });
      }
    }
    persist(form.getValues(), index, true);
    setStep(index);
  }

  // O "Não enviado" por item: o que difere do que o servidor confirmou. Com transação na fila, a base é o original da
  // mais antiga; sem, o registro. A outbox é lida a cada segundo: logo depois de ir para a fila, a base de antes fica
  // até a transação aparecer nela ou o servidor confirmar (a `version` muda), para o indicador não piscar.
  if (enqueued && id && (bases.has(id) || record?.version !== enqueued.version)) setEnqueued(null);
  const base = baseNow;
  const pending = current ? pendingItemIds(current, base) : new Set<string>();
  const itemSync = (itemId: string, index: number): FieldSyncState | undefined => {
    const itemErrors = errors.rooms?.[step]?.items?.[index];
    if (itemErrors?.condition || itemErrors?.notes) return "rejeitado";
    if (disputed.items.has(itemId)) return "conflito";
    if (!pending.has(itemId)) return undefined;
    return sending ? "enviando" : "local";
  };

  const place = source ? placesOf(properties, clients).get(source.propertyId) : undefined;
  const header = source ? fieldHeader(source, place) : undefined;
  const rowSync: SyncBadgeState | undefined =
    draft?.status === "rejected"
      ? "rejeitado"
      : draft?.status === "conflict"
        ? "conflito"
        : id
          ? states.get(id)
          : undefined;

  const itemErrors = Object.keys(errorKeys(errors)).filter(
    (key) => key.endsWith(".condition") || key.endsWith(".notes"),
  );
  const errorRooms = [...new Set(itemErrors.map(roomOfError))];
  const rejection =
    draft?.status === "rejected" && (itemErrors.length > 0 || outsideErrors.length > 0)
      ? {
          title: REJECTED_TITLE,
          description:
            itemErrors.length === 0
              ? outsideErrors.join(" ")
              : `${
                  errorRooms.length === 1 && errorRooms[0] !== undefined
                    ? `${current?.rooms[errorRooms[0]]?.name ?? "Ambiente"}: ${plural(itemErrors.length, "item", "itens")}`
                    : `${plural(itemErrors.length, "item", "itens")} em ${errorRooms.length} ambientes`
                } ${itemErrors.length === 1 ? "precisa" : "precisam"} de correção. Corrija e ela é enviada de novo.`,
        }
      : null;

  return {
    status: status === "found" && !hydrated ? ("loading" as const) : status,
    header: header && { ...header, sync: rowSync },
    form,
    step,
    goTo,
    rooms,
    summary: roomsSummary(rooms),
    /** "Cozinha · 3 de 7". */
    position: room ? `${room.name} · ${step + 1} de ${rooms.length}` : "",
    /** Os itens do ambiente aberto, com o índice no formulário e o estado de sync de cada um. */
    items: (room?.items ?? []).map((item, index) => ({
      id: item.id,
      name: item.name,
      index,
      sync: itemSync(item.id, index),
    })),
    room: rooms[step],
    /** Envio da vistoria no ar: o formulário fica só leitura (ADR 0021). */
    readOnly: sending,
    rejection,
    /** Estado 5: o aviso e o caminho para o ConflictResolver (o `deleted` chega na #109). */
    conflict:
      inConflict && conflict && id
        ? { title: CONFLICT_TITLE, description: CONFLICT_DESCRIPTION, href: conflictHref(id) }
        : null,
    conditions: CONDITION_VALUES.map((value) => ({ value, label: CONDITIONS[value] })),
    notesMax: NOTES_MAX,
  };
}
