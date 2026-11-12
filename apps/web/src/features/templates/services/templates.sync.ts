import {
  type TemplateDto,
  getTemplate,
  syncTemplates,
  upsertTemplate,
} from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { type DraftsCollection, clearDraft, keepConflictData } from "@/shared/sync/drafts";
import { flatConflictOf } from "@/shared/sync/flat-conflict";
import { newId } from "@/shared/sync/ids";
import { recordShape } from "@/shared/sync/merge";
import { type Outbox, type OutboxMutationFn, enqueue } from "@/shared/sync/outbox";
import type { PullEntity } from "@/shared/sync/pull";
import { registerRecordLabel } from "@/shared/sync/sync-view";
import { type MergeStrategy, flatMerge, upsertMutation } from "@/shared/sync/upsert";

import { TEMPLATE_ENTITY, type TemplateRecord, type TemplateRoom } from "../models/template";
import type { TemplatesCollection } from "./templates.collection";

// Os roteiros no banco local (#172): o mesmo caminho de clientes e imóveis, sem tela ainda. As telas, com o
// ConflictResolver e o `registerConflictView`, são da #173; a Nova vistoria a partir de um roteiro, da #174.

export const UPSERT_TEMPLATE = "upsertTemplate";
/** O laço de roteiros no pull, que dá nome ao cursor e às marcas. */
export const TEMPLATES_PULL = "templates";

registerRecordLabel(UPSERT_TEMPLATE, (record) => `Roteiro · ${String(record.name ?? "")}`);

const byPosition = <T extends { position: number }>(rows: readonly T[]) =>
  rows.toSorted((a, b) => a.position - b.position);

/** Ambientes e itens na ordem da `position`, como o servidor os guarda e como a tela os mostra. */
const ordered = (rooms: readonly TemplateRoom[]): TemplateRoom[] =>
  byPosition(rooms).map((room) => ({
    id: room.id,
    name: room.name,
    position: room.position,
    items: byPosition(room.items).map(({ id, name, position }) => ({ id, name, position })),
  }));

/**
 * O merge de um conflito de roteiro: o plano por campo (ADR 0038), com `rooms` como um campo só. Provisório: a #173,
 * que traz o ConflictResolver, pode trocá-lo pelo merge por id de ambiente e item, como o da vistoria.
 */
const templateMerge: MergeStrategy<TemplateRecord> = {
  shape: (current, like) => {
    const shaped = recordShape(current, like);
    return { ...shaped, rooms: ordered(shaped.rooms ?? []) };
  },
  merge: flatMerge.merge,
};

/** Envia a transação como `PUT /api/v1/templates/{id}` (`upsertMutation`), na outbox única (ADR 0034). */
export function upsertTemplateMutation(
  templates: TemplatesCollection,
  drafts: DraftsCollection,
  client?: Client,
): OutboxMutationFn<TemplateRecord> {
  return upsertMutation<TemplateRecord>({
    store: templates,
    drafts,
    entity: TEMPLATE_ENTITY,
    send: (request) => upsertTemplate({ client, ...request }),
    strategy: templateMerge,
  });
}

/** O que o editor de roteiro edita. */
export type TemplateValues = Omit<TemplateRecord, "id" | "version">;

/**
 * Cria (sem `id`) ou edita um roteiro: aplica na hora e enfileira o `PUT`. A edição mantém a `version` do registro;
 * salvar de novo apaga o rascunho recusado. Com o rascunho em conflito, o que foi salvo fica só nele, para o
 * ConflictResolver (frontend.md, "Conflito"). Devolve o id.
 */
export function saveTemplate(
  {
    templates,
    drafts,
    outbox,
  }: { templates: TemplatesCollection; drafts: DraftsCollection; outbox: Outbox },
  values: TemplateValues & { id?: string },
): string {
  const id = values.id ?? newId();
  const record: TemplateRecord = {
    ...values,
    rooms: ordered(values.rooms),
    id,
    version: templates.get(id)?.version ?? null,
  };
  if (flatConflictOf(drafts.get(id))) {
    keepConflictData(drafts, id, record);
    return id;
  }
  enqueue(outbox, UPSERT_TEMPLATE, () => {
    if (templates.has(id)) {
      templates.update(id, (draft) => {
        Object.assign(draft, record);
      });
    } else {
      templates.insert(record);
    }
  });
  clearDraft(drafts, id);
  return id;
}

/** Do DTO do servidor para o registro local: fica o que vai no `PUT` e a `version`; as datas são do servidor. */
export function templateRecordOf(dto: TemplateDto): TemplateRecord {
  return { id: dto.id, version: dto.version, name: dto.name, rooms: ordered(dto.rooms) };
}

/**
 * O laço de roteiros do pull (`syncTemplates`), antes do de vistorias: a vistoria nasce de um roteiro, e a fila já
 * manda o roteiro antes dela (ADR 0034).
 */
export function templatesPull(
  templates: TemplatesCollection,
  client?: Client,
): PullEntity<TemplateRecord, TemplateDto> {
  return {
    name: TEMPLATES_PULL,
    store: templates,
    page: (request) => syncTemplates({ client, ...request }),
    get: (request) => getTemplate({ client, ...request }),
    shape: templateRecordOf,
  };
}
