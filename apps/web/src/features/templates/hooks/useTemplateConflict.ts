import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { flatConflictOf, resolveFlat } from "@/shared/sync/flat-conflict";
import { conflictOrigin, useConflictChoices } from "@/shared/sync/useConflictChoices";

import { TEMPLATE_ENTITY, type TemplateRecord } from "../models/template";
import { resolveTemplateConflict } from "../services/templates.sync";
import { templateConflictGroups } from "../services/templates.view";

/**
 * O ConflictResolver de um roteiro (frontend.md, "Conflito"; ADR 0038 e 0057): o merge por campo, com Nome e
 * Ambientes, refeito a partir do rascunho em conflito, as escolhas da pessoa e o envio da resolução. As escolhas vivem
 * só na tela.
 */
export function useTemplateConflict(id: string | null) {
  const { store, ready, templates, drafts } = useLocalStore();

  const draft = id
    ? drafts.find((candidate) => candidate.id === id && candidate.entity === TEMPLATE_ENTITY)
    : undefined;
  const conflict = flatConflictOf<TemplateRecord>(draft);
  const groups = conflict ? templateConflictGroups(conflict) : [];
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
    /** O roteiro existe neste aparelho (para "Abrir o roteiro" quando não há conflito). */
    known: id !== null && (draft !== undefined || templates.some((entry) => entry.id === id)),
    description: conflict
      ? `${conflict.local.name}. Ele foi alterado em outro aparelho enquanto você editava. O que só um lado mudou já foi mesclado; escolha o valor que fica em cada campo abaixo.`
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
            resolveTemplateConflict(store, {
              resolved: resolveFlat(conflict, picked),
              server: conflict.server,
            }),
          )
        : Promise.resolve(false),
  };
}
