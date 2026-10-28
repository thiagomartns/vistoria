import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { conflictOrigin, useConflictChoices } from "@/shared/sync/useConflictChoices";

import { INSPECTION_ENTITY } from "../models/inspection";
import { inspectionConflictOf, resolveInspection } from "../services/inspections.resolve";
import { resolveInspectionConflict } from "../services/inspections.sync";
import { conflictGroups, fieldHeader } from "../services/inspections.view";
import { placesOf } from "./useInspections";

/**
 * O ConflictResolver de uma vistoria (frontend.md, "Conflito"): o merge refeito a partir do rascunho em conflito, as
 * escolhas da pessoa ("meu" ou "servidor" por campo) e o envio da resolução. As escolhas vivem só na tela: sair sem
 * enviar deixa o conflito como estava.
 */
export function useInspectionConflict(id: string | null) {
  const { store, ready, inspections, properties, clients, drafts } = useLocalStore();

  const draft = id
    ? drafts.find((candidate) => candidate.id === id && candidate.entity === INSPECTION_ENTITY)
    : undefined;
  const conflict = inspectionConflictOf(draft);
  const places = placesOf(properties, clients);
  const groups = conflict ? conflictGroups(conflict, places) : [];
  const { choices, done, submit, ...resolution } = useConflictChoices(
    groups.flatMap((group) => group.fields.map((field) => field.key)),
  );
  const header = conflict
    ? fieldHeader(conflict.local, places.get(conflict.local.propertyId))
    : undefined;

  return {
    ...resolution,
    /** `done`: a resolução saiu e o rascunho já não está em conflito; a tela só sai. */
    status: done
      ? ("done" as const)
      : !ready
        ? ("loading" as const)
        : conflict
          ? ("found" as const)
          : ("none" as const),
    /** A vistoria existe neste aparelho (para "Abrir a vistoria" quando não há conflito). */
    known: id !== null && (draft !== undefined || inspections.some((entry) => entry.id === id)),
    description: header
      ? `${header.title} · ${header.compactSubtitle}. Ela foi alterada em outro aparelho enquanto você editava. O que só um lado mudou já foi mesclado; escolha o valor que fica em cada campo abaixo.`
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
            resolveInspectionConflict(store, {
              resolved: resolveInspection(conflict, picked),
              server: conflict.server,
            }),
          )
        : Promise.resolve(false),
  };
}
