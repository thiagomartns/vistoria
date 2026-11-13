import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import { conflictHref } from "../services/inspections.resolve";
import { DELETE_INSPECTION, UPSERT_INSPECTION } from "../services/inspections.sync";
import {
  type InspectionSyncState,
  historyEntryOf,
  propertyHistory,
} from "../services/inspections.view";
import { useInspectionSummaries } from "./useInspectionSummaries";
import { inspectionHref, reportHref, withBack } from "./useInspections";

/** A tela do imóvel com a aba do histórico aberta: para onde o "Voltar" da tela de campo e do laudo leva. */
export const propertyHistoryHref = (propertyId: string) =>
  `/properties/edit?id=${encodeURIComponent(propertyId)}&tab=vistorias`;

/** A Nova vistoria com o imóvel escolhido. */
export const newInspectionHref = (propertyId: string) =>
  `/inspections/new?propertyId=${encodeURIComponent(propertyId)}`;

export interface PropertyHistoryItem {
  id: string;
  href: string;
  title: string;
  meta: string;
  marker: "hollow" | "filled" | "muted";
  /** O SyncBadge, só fora do sincronizado. */
  sync: Exclude<InspectionSyncState, "sincronizado"> | null;
}

/**
 * O histórico do imóvel em /properties/edit?id= (#176, Figma "Imóvel · vistorias (#176)"): as vistorias dele lidas do
 * resumo com a fila por cima (ADR 0048), da mais nova para a mais antiga. O item abre o ConflictResolver em conflito, o
 * laudo na concluída e confirmada (ADR 0054), e a tela de campo nas outras; a tela de campo e o laudo voltam para cá.
 * Fica pronto depois da primeira leitura dos resumos e da fila.
 */
export function usePropertyHistory(propertyId: string | null) {
  const { store, ready, drafts, states, pending, outboxRead } = useLocalStore();
  const summaries = useInspectionSummaries(store);
  const queued = new Map(
    [...pending].filter(
      ([, entry]) =>
        entry.mutationFnName === UPSERT_INSPECTION || entry.mutationFnName === DELETE_INSPECTION,
    ),
  );
  const historyReady = ready && summaries.isReady && outboxRead && propertyId !== null;
  const rows =
    historyReady && propertyId
      ? propertyHistory(summaries.data, queued, drafts, states, propertyId)
      : [];
  const back = propertyId ? propertyHistoryHref(propertyId) : "";
  return {
    ready: historyReady,
    /** "3 vistorias", "1 vistoria", "Nenhuma vistoria". */
    count:
      rows.length === 0
        ? "Nenhuma vistoria"
        : `${rows.length} ${rows.length === 1 ? "vistoria" : "vistorias"}`,
    total: rows.length,
    newHref: propertyId ? newInspectionHref(propertyId) : "",
    items: rows.map((row): PropertyHistoryItem => {
      const view = historyEntryOf(row);
      return {
        id: row.id,
        href:
          row.sync === "conflito"
            ? conflictHref(row.id)
            : withBack(
                row.status === "completed" && row.sync === "sincronizado"
                  ? reportHref(row.id)
                  : inspectionHref(row.id),
                back,
              ),
        ...view,
        sync: row.sync === "sincronizado" ? null : row.sync,
      };
    }),
  };
}
