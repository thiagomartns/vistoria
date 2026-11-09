import { useEffect, useRef, useState } from "react";
import {
  type FieldErrors,
  type FieldPath,
  type UseFormReturn,
  useForm,
  useFormState,
  useWatch,
} from "react-hook-form";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { FieldSyncState } from "@/shared/components/field-sync-indicator";
import type { SyncBadgeState } from "@/shared/components/sync-badge";
import type { DraftRecord } from "@/shared/sync/drafts";
import { type UnavailableMessages, useFetchMissing } from "@/shared/sync/useFetchMissing";

import { INSPECTION_ENTITY, type InspectionRecord } from "../models/inspection";
import {
  CONDITIONS,
  CONDITION_VALUES,
  type InspectionFormValues,
  NOTES_MAX,
  NO_CONDITION,
  NO_ITEMS,
  NO_ROOMS,
  completionErrors,
  formPathOf,
  formValuesOf,
  recordWith,
  roomOfError,
  roomStepSchema,
  withUnsaved,
} from "../schemas/inspection.schemas";
import {
  conflictHref,
  conflictKindOf,
  inspectionConflictOf,
} from "../services/inspections.resolve";
import {
  completeInspection,
  deleteInspection,
  fetchInspection,
  saveInspection,
  saveInspectionDraft,
} from "../services/inspections.sync";
import {
  INCOMPLETE_TITLE,
  INSPECTION_KINDS,
  completionView,
  conflictPlaces,
  deletionSubject,
  fieldHeader,
  incompleteDescription,
  pendingItemIds,
  roomViews,
  roomsSummary,
} from "../services/inspections.view";
import { useInspectionRecord } from "./useInspectionRecord";
import { placesOf } from "./useInspections";

/** Depois da última mudança, o rascunho é gravado; fechar a aba depois disso não perde nada. */
export const DRAFT_DEBOUNCE_MS = 300;
/** Depois da última mudança, a vistoria vai para a fila (e também ao trocar de ambiente ou sair da tela). */
export const QUEUE_DEBOUNCE_MS = 1500;

export const REJECTED_TITLE = "O servidor recusou esta vistoria";
/** A recusa de uma conclusão (Figma 55:5920): o servidor achou item sem condição ou ambiente sem item. */
export const COMPLETION_REJECTED_TITLE = "Não foi possível concluir a vistoria";
/** "Concluir vistoria": o Próximo do último ambiente (Figma 164:12824, estado 1). */
export const FINISH_LABEL = "Concluir vistoria";

const COMPLETION_MESSAGES: readonly string[] = [NO_ROOMS, NO_ITEMS, NO_CONDITION];

/** O aviso do estado 5 (Figma 55:5132). */
export const CONFLICT_TITLE = "Esta vistoria foi alterada em outro aparelho";
export const CONFLICT_DESCRIPTION =
  "Suas alterações estão salvas neste aparelho. Escolha o que fica em cada campo para enviar de novo.";

/** O aviso de uma vistoria excluída em outro aparelho (tipo excluído do ConflictResolver, ADR 0040). */
export const DELETED_TITLE = "Esta vistoria foi excluída em outro aparelho";
export const DELETED_DESCRIPTION =
  "Suas alterações estão salvas neste aparelho. Recrie a vistoria com os mesmos dados ou descarte as alterações.";

/** O aviso de uma exclusão que achou a vistoria alterada (tipo exclusão alterada, ADR 0040): só leitura. */
export const REMOVAL_TITLE = "Esta vistoria foi alterada antes da exclusão";
export const REMOVAL_DESCRIPTION =
  "A exclusão não saiu. A tela mostra a vistoria como está no servidor; decida se exclui mesmo assim.";

/** Sem a vistoria no aparelho (leitura por id, frontend.md, "Leitura (pull)"). */
export const UNAVAILABLE: UnavailableMessages = {
  offline:
    "Esta vistoria ainda não está neste aparelho. Abra-a uma vez com internet para trabalhar nela offline.",
  notFound: "Esta vistoria não existe ou foi excluída.",
  failed: "Não foi possível buscar esta vistoria agora.",
};

/** O aviso do estado 6 do #107: a exclusão está na fila, e a tela fica só leitura. */
export const DELETION_TITLE = "Exclusão aguardando envio";
export const DELETION_DESCRIPTION = "Esta vistoria será excluída quando a conexão voltar.";

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

/**
 * Recarrega o formulário aberto com `next` (um merge sem colisão ou a versão que o pull trouxe): ela vira a base, e o
 * que a pessoa marcou e não chegou ao rascunho fica por cima, sujo (`withUnsaved`). `shown` guarda a estrutura que o
 * formulário mostra, para casar os itens pelo id. Uma concluída (em outro aparelho) não muda mais: o formulário mostra
 * só o que ela tem.
 */
function reloadForm(
  form: UseFormReturn<InspectionFormValues>,
  shown: { current: InspectionRecord | undefined },
  next: InspectionRecord,
) {
  const previous = next.status === "completed" ? undefined : shown.current;
  const values = previous
    ? withUnsaved(
        next,
        previous,
        form.getValues(),
        form.formState.defaultValues as InspectionFormValues,
      )
    : formValuesOf(next);
  form.reset(formValuesOf(next));
  form.reset(values, { keepDefaultValues: true });
  shown.current = next;
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
 * - Excluir (`remove`) põe a exclusão na fila e para de gravar e de enfileirar, inclusive no flush de sair da tela: um
 *   `PUT` depois do `DELETE` não pode sair (ADR 0039). Com a exclusão na fila, a tela fica só leitura (estado 6 do #107).
 * - Excluída em outro aparelho, segue como no conflito de edição, com o aviso do tipo excluído. Com a exclusão
 *   recusada porque a vistoria mudou, fica só leitura com o que o servidor tem, até "Excluir mesmo assim?" (ADR 0040).
 * - "Concluir vistoria" no último ambiente (`requestCompletion`) confere o `completeInspectionSchema`: com algo
 *   faltando, marca os chips, vai para o ambiente do primeiro erro e não enfileira nada; sem nada faltando, abre o
 *   Dialog. Confirmado (`complete`), a conclusão vai para a fila e o rascunho sai. Concluída (aqui, com a conclusão na
 *   fila, ou em outro aparelho), a tela fica só leitura e nada mais vai para o rascunho nem para a fila (ADR 0050).
 */
export function useInspectionDraft(id: string | null) {
  const { store, ready: storeReady, properties, clients, drafts, states, bases } = useLocalStore();
  // A vistoria completa só carrega por id (ADR 0048).
  const { record, ready: recordReady } = useInspectionRecord(store, id);
  const ready = storeReady && recordReady;
  const draft = id
    ? drafts.find((candidate) => candidate.id === id && candidate.entity === INSPECTION_ENTITY)
    : undefined;
  // A vistoria que a tela mostra: o rascunho tem o mais novo (numa criação recusada, é o único lugar onde ela existe).
  const source = (draft?.data as InspectionRecord | undefined) ?? record;
  // Um id que o aparelho não tem é buscado no servidor, com o imóvel e o cliente; até chegar, a tela segue carregando.
  const fetched = useFetchMissing(
    ready && id && !source ? id : null,
    store && ((key) => fetchInspection(store, key)),
    UNAVAILABLE,
  );
  const unavailable = id ? fetched.unavailable : { description: UNAVAILABLE.notFound };
  const status = !ready
    ? "loading"
    : source && id
      ? "found"
      : unavailable
        ? "unavailable"
        : "loading";
  const inConflict = draft?.status === "conflict";
  const conflictKind = conflictKindOf(draft);
  const deleting = record?.deleting === true;
  /** A exclusão achou a vistoria alterada: a tela mostra o servidor, só leitura, até a pessoa decidir (ADR 0040). */
  const removalConflict = conflictKind === "removal";
  /** A pessoa confirmou a exclusão nesta tela: nada mais vai para o rascunho nem para a fila. */
  const removed = useRef(false);
  /** A pessoa concluiu nesta tela: nada mais vai para o rascunho nem para a fila, nem no flush de sair. */
  const completed = useRef(false);
  /** Concluída: confirmada, na fila ou adotada de outro aparelho. Uma conclusão recusada volta em andamento. */
  const concluded = record?.status === "completed" && draft?.status !== "rejected";

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
  /** A `version` do registro que o formulário já mostra. */
  const shownVersion = useRef<string | null | undefined>(undefined);
  /** O registro (a estrutura de ambientes e itens) que o formulário mostra. */
  const shownRecord = useRef<InspectionRecord | undefined>(undefined);
  useEffect(() => {
    if (!opened) return;
    const { record: base, draft: saved, source: shown } = opening.current;
    if (!shown) return;
    form.reset(formValuesOf(base ?? emptied(shown)));
    if (saved)
      form.reset(formValuesOf(saved.data as InspectionRecord), { keepDefaultValues: true });
    openedWith.current = JSON.stringify(form.getValues());
    rebased.current = saved?.rebasedAt;
    shownVersion.current = base?.version;
    shownRecord.current = shown;
  }, [opened, form]);

  // O rascunho foi regravado com a tela aberta: um merge sem colisão que já foi para a fila, ou a versão que o pull
  // trouxe para um rascunho sem nada a enviar (ADR 0043). O formulário passa a mostrar o novo; sem isso, o próximo envio
  // levaria os valores de antes por cima do que veio do servidor. O que a pessoa marcou e não chegou ao rascunho fica.
  const rebasedAt = draft?.rebasedAt;
  useEffect(() => {
    if (!hydrated || rebased.current === rebasedAt) return;
    rebased.current = rebasedAt;
    const saved = opening.current.draft;
    if (saved) reloadForm(form, shownRecord, saved.data as InspectionRecord);
  }, [hydrated, rebasedAt, form]);

  // Sem rascunho ainda (a tela abriu há menos que o debounce dele), o pull grava a versão nova só no registro: o
  // formulário recarrega com ela, senão o rascunho que vem logo depois guardaria os valores de antes por cima. Com
  // rascunho, quem avisa é o `rebasedAt`, e a `version` que muda pelo próprio envio não recarrega nada.
  const version = record?.version;
  useEffect(() => {
    if (!hydrated || shownVersion.current === version) return;
    shownVersion.current = version;
    const { record: next, draft: saved } = opening.current;
    if (next && !saved) reloadForm(form, shownRecord, next);
  }, [hydrated, version, form]);

  // Os erros de um rascunho recusado vão para os campos na abertura e quando uma recusa chega com a tela aberta; uma
  // vez por recusa, para não voltar a marcar o que a pessoa já corrigiu.
  const rejected = draft?.status === "rejected" ? draft.errors : null;
  const rejectedKey = rejected ? JSON.stringify(rejected) : null;
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || applied.current === rejectedKey) return;
    applied.current = rejectedKey;
    const entries = Object.entries(
      rejectedKey ? (JSON.parse(rejectedKey) as Record<string, string[]>) : {},
    );
    for (const [key, messages] of entries) {
      const path = formPathOf(key);
      if (path) form.setError(path, { type: "server", message: messages[0] });
    }
  }, [hydrated, rejectedKey, form]);
  // A recusa que chega com a tela aberta leva ao ambiente do primeiro erro (frontend.md, "Formulários profundos"); na
  // abertura, quem leva é o passo inicial. Trocado no render, como a vistoria aberta.
  const [rejectionShown, setRejectionShown] = useState<string | null>(null);
  if (hydrated && rejectionShown !== rejectedKey) {
    setRejectionShown(rejectedKey);
    const errorRooms = Object.keys(rejected ?? {})
      .map(roomOfError)
      .filter((index) => index !== undefined);
    if (errorRooms.length > 0) setStep(Math.min(...errorRooms));
  }
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
    if (!store || !hydrated || !source || removed.current || completed.current || concluded) return;
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

  // O que falta para concluir, depois de a pessoa tentar: conferido a cada render, então o aviso encolhe a cada chip
  // marcado e some quando nada falta.
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const incomplete = checking && current && !concluded ? completionErrors(current) : {};
  /** Erros da conclusão fora dos chips (ambiente sem item, vistoria sem ambiente): só a etapa e o aviso os mostram. */
  const roomErrors = Object.fromEntries(
    Object.entries(incomplete).filter(([key]) => !formPathOf(key)),
  );
  const rooms = current
    ? roomViews(current.rooms, { ...errorKeys(errors), ...roomErrors }, disputed.rooms)
    : [];
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

  /**
   * "Concluir vistoria" (Figma 164:12824): confere o que falta. Com erro, marca os chips, vai para o ambiente do primeiro
   * e só grava o rascunho; sem erro, abre o Dialog.
   */
  function requestCompletion() {
    if (!source || !hydrated || concluded) return;
    const values = form.getValues();
    const missing = completionErrors(recordWith(source, values));
    const keys = Object.keys(missing);
    if (keys.length === 0) {
      setChecking(false);
      setConfirming(true);
      return;
    }
    for (const [key, messages] of Object.entries(missing)) {
      const path = formPathOf(key);
      if (path) form.setError(path, { type: "complete", message: messages[0] });
    }
    const first = Math.min(...keys.map((key) => roomOfError(key) ?? 0));
    setChecking(true);
    persist(values, first, false);
    setStep(first);
  }

  // O "Não enviado" por item: o que difere do que o servidor confirmou. Com transação na fila, a base é o original da
  // mais antiga; sem, o registro. A outbox é lida a cada segundo: logo depois de ir para a fila, a base de antes fica
  // até a transação aparecer nela ou o servidor confirmar (a `version` muda), para o indicador não piscar.
  if (enqueued && id && (bases.has(id) || record?.version !== enqueued.version)) setEnqueued(null);
  const base = baseNow;
  const pending = current ? pendingItemIds(current, base) : new Set<string>();
  const itemSync = (itemId: string, index: number): FieldSyncState | undefined => {
    // A vistoria está saindo ou concluída: o estado por campo não diz mais nada (estado 6 do #107; 164:12824).
    if (deleting || concluded) return undefined;
    const itemErrors = errors.rooms?.[step]?.items?.[index];
    if (itemErrors?.condition || itemErrors?.notes) return "rejeitado";
    if (disputed.items.has(itemId)) return "conflito";
    if (!pending.has(itemId)) return undefined;
    return sending ? "enviando" : "local";
  };

  const place = source ? placesOf(properties, clients).get(source.propertyId) : undefined;
  const header = source ? fieldHeader(source, place) : undefined;
  const rowSync: SyncBadgeState | undefined = deleting
    ? "excluindo"
    : draft?.status === "rejected"
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
  const roomNames = current?.rooms.map((each) => each.name) ?? [];
  const completionRejected =
    rejected !== null &&
    Object.values(rejected).some((messages) =>
      messages.some((message) => COMPLETION_MESSAGES.includes(message)),
    );
  const rejection =
    Object.keys(incomplete).length > 0
      ? { title: INCOMPLETE_TITLE, description: incompleteDescription(incomplete, roomNames) }
      : completionRejected && rejected
        ? { title: COMPLETION_REJECTED_TITLE, description: incompleteDescription(rejected, roomNames) }
        : draft?.status === "rejected" && (itemErrors.length > 0 || outsideErrors.length > 0)
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
    /** Sem a vistoria: sem rede, não encontrada ou falha do servidor (`RecordUnavailable`). */
    unavailable,
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
    /**
     * Envio da vistoria no ar (ADR 0021), exclusão na fila, exclusão recusada à espera da pessoa ou concluída: o
     * formulário fica só leitura.
     */
    readOnly: sending || deleting || removalConflict || concluded,
    /** Estado 6 do #107: a exclusão está na fila. */
    deletion: deleting ? { title: DELETION_TITLE, description: DELETION_DESCRIPTION } : null,
    /** O "···" com "Excluir vistoria": só em andamento e uma vez só. */
    deletable: source?.status === "inProgress" && !deleting && !removalConflict && !concluded,
    /** Concluída: o aviso da confirmada (com a data) ou da conclusão na fila (Figma 164:12824, estados 4 e 5). */
    completion:
      concluded && record
        ? completionView(record, id ? states.has(id) || record.version === null : false)
        : null,
    /**
     * "Concluir vistoria" no último ambiente: só em andamento, fora de conflito e sem exclusão. Em conflito, o envio sai
     * pelo ConflictResolver, então concluir também espera ele.
     */
    finish:
      hydrated && !concluded && !deleting && !removalConflict && !inConflict
        ? { label: FINISH_LABEL, onClick: requestCompletion }
        : undefined,
    /** O Dialog "Concluir esta vistoria?" (estado 2). */
    confirming,
    setConfirming,
    /** Põe a conclusão na fila (o `PUT` com `status: completed`) e encerra o rascunho. */
    complete() {
      if (!store || !source || !hydrated || concluded) return;
      completed.current = true;
      completeInspection(store, withoutVersion(recordWith(source, form.getValues())));
      form.reset(form.getValues());
    },
    /** O que o Dialog de exclusão nomeia, e se ele avisa que há alteração não enviada (estado 3 do #107). */
    deleteSubject: header
      ? deletionSubject(header.title, source ? INSPECTION_KINDS[source.kind] : null)
      : "",
    unsent: (rowSync !== undefined && rowSync !== "excluindo") || isDirty,
    /** Põe a exclusão na fila e descarta o que não foi enviado. */
    async remove() {
      if (!store || !id) return;
      removed.current = true;
      await deleteInspection(store, id);
    },
    rejection,
    /** Estado 5 e os tipos excluído e exclusão alterada: o aviso e o caminho para o ConflictResolver. */
    conflict: !id
      ? null
      : conflictKind === "deleted"
        ? { title: DELETED_TITLE, description: DELETED_DESCRIPTION, href: conflictHref(id) }
        : removalConflict
          ? { title: REMOVAL_TITLE, description: REMOVAL_DESCRIPTION, href: conflictHref(id) }
          : inConflict && conflict
            ? { title: CONFLICT_TITLE, description: CONFLICT_DESCRIPTION, href: conflictHref(id) }
            : null,
    conditions: CONDITION_VALUES.map((value) => ({ value, label: CONDITIONS[value] })),
    notesMax: NOTES_MAX,
  };
}
