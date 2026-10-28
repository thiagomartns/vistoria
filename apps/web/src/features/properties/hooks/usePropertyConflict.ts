import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { flatConflictOf, resolveFlat } from "@/shared/sync/flat-conflict";
import { conflictOrigin, useConflictChoices } from "@/shared/sync/useConflictChoices";

import { PROPERTY_ENTITY, type PropertyRecord } from "../models/property";
import { resolvePropertyConflict } from "../services/properties.sync";
import { addressOf, propertyConflictGroups } from "../services/properties.view";

/**
 * O ConflictResolver de um imóvel (frontend.md, "Conflito"; ADR 0038): o merge por campo refeito a partir do rascunho
 * em conflito, as escolhas da pessoa e o envio da resolução. As escolhas vivem só na tela.
 */
export function usePropertyConflict(id: string | null) {
  const { store, ready, clients, properties, drafts } = useLocalStore();

  const draft = id
    ? drafts.find((candidate) => candidate.id === id && candidate.entity === PROPERTY_ENTITY)
    : undefined;
  const conflict = flatConflictOf<PropertyRecord>(draft);
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const groups = conflict ? propertyConflictGroups(conflict, clientNames) : [];
  const { choices, done, submit, ...resolution } = useConflictChoices(
    groups.flatMap((group) => group.fields.map((field) => field.key)),
  );

  return {
    ...resolution,
    status: done
      ? ("done" as const)
      : !ready
        ? ("loading" as const)
        : conflict
          ? ("found" as const)
          : ("none" as const),
    /** O imóvel existe neste aparelho (para "Abrir o imóvel" quando não há conflito). */
    known: id !== null && (draft !== undefined || properties.some((entry) => entry.id === id)),
    description: conflict
      ? `${addressOf(conflict.local)}. Ele foi alterado em outro aparelho enquanto você editava. O que só um lado mudou já foi mesclado; escolha o valor que fica em cada campo abaixo.`
      : "",
    mineOrigin: conflictOrigin("Neste aparelho", conflict?.localAt),
    theirsOrigin: conflictOrigin("No servidor", conflict?.serverAt),
    groups: groups.map((group) => ({
      ...group,
      fields: group.fields.map((field) => ({ ...field, choice: choices[field.key] })),
    })),
    /** Envia a resolução. Devolve `true` quando ela saiu (ou só adotou o servidor). */
    submit: (): Promise<boolean> =>
      store && conflict
        ? submit((picked) =>
            resolvePropertyConflict(store, {
              resolved: resolveFlat(conflict, picked),
              server: conflict.server,
            }),
          )
        : Promise.resolve(false),
  };
}
