import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import { DELETE_INSPECTION, UPSERT_INSPECTION } from "../services/inspections.sync";
import { type EditImpact, editImpact } from "../services/inspections.view";
import { useInspectionSummaries } from "./useInspectionSummaries";

/**
 * Quantas vistorias usam os imóveis `propertyIds` (#234): as em andamento e as concluídas, do resumo com a fila por
 * cima, como o histórico do imóvel. `null` sem imóveis ou antes da primeira leitura dos resumos e da fila.
 */
export function useInspectionImpact(propertyIds: readonly string[] | null): EditImpact | null {
  const { store, ready, drafts, pending, outboxRead } = useLocalStore();
  const summaries = useInspectionSummaries(store);
  if (!propertyIds || propertyIds.length === 0 || !ready || !summaries.isReady || !outboxRead) {
    return null;
  }
  const queued = new Map(
    [...pending].filter(
      ([, entry]) =>
        entry.mutationFnName === UPSERT_INSPECTION || entry.mutationFnName === DELETE_INSPECTION,
    ),
  );
  return editImpact(summaries.data, queued, drafts, new Set(propertyIds));
}
