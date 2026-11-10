import { useState } from "react";

import type { ClientRecord } from "@/features/clients/models/client";
import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { PropertyRecord } from "@/features/properties/models/property";
import { addressOf } from "@/features/properties/services/properties.view";

import { conflictHref } from "../services/inspections.resolve";
import { DELETE_INSPECTION, UPSERT_INSPECTION, deleteInspection } from "../services/inspections.sync";
import { useInspectionSummaries } from "./useInspectionSummaries";
import {
  LIST_PAGE_SIZE,
  type PlaceView,
  countLabel,
  dateOf,
  deletionSubject,
  hasUnsent,
  inspectionPage,
  isDeletable,
  startedLabel,
} from "../services/inspections.view";

/** A lista; para onde "Voltar" e "Cancelar" levam. */
export const INSPECTIONS_HREF = "/inspections";

/** A tela de campo de uma vistoria. */
export const inspectionHref = (id: string) => `/inspections/edit?id=${encodeURIComponent(id)}`;

/** O laudo de uma vistoria concluída. */
export const reportHref = (id: string) => `/inspections/report?id=${encodeURIComponent(id)}`;

/** O imóvel de cada vistoria no aparelho: o endereço e o nome do cliente. */
export function placesOf(
  properties: readonly PropertyRecord[],
  clients: readonly ClientRecord[],
): Map<string, PlaceView> {
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  return new Map(
    properties.map((property) => [
      property.id,
      { address: addressOf(property), clientName: clientNames.get(property.clientId) ?? null },
    ]),
  );
}

/**
 * As vistorias do banco local para a lista de /inspections, com o imóvel, o cliente e o estado de sync. A linha abre a
 * tela de campo, ou o ConflictResolver quando a vistoria está em conflito. `remove` põe a exclusão na fila (ADR 0039).
 * A lista monta `LIST_PAGE_SIZE` linhas por vez; `showMore` monta mais uma página (ADR 0047). Ela lê o resumo de cada
 * vistoria e a fila, nunca as vistorias completas (ADR 0048): só fica pronta depois da primeira leitura da fila.
 */
export function useInspections() {
  const { store, ready, properties, clients, drafts, states, pending, outboxRead } =
    useLocalStore();
  const summaries = useInspectionSummaries(store);
  const [limit, setLimit] = useState(LIST_PAGE_SIZE);
  // As transações da fila que são de vistoria.
  const queued = new Map(
    [...pending].filter(
      ([, entry]) =>
        entry.mutationFnName === UPSERT_INSPECTION || entry.mutationFnName === DELETE_INSPECTION,
    ),
  );
  const listReady = ready && summaries.isReady && outboxRead;
  // Antes de pronta, a lista não mostra nada: montar as linhas seria custo à toa.
  const { rows, total } = listReady
    ? inspectionPage(summaries.data, queued, drafts, states, placesOf(properties, clients), limit)
    : { rows: [], total: 0 };
  return {
    ready: listReady,
    /** O aparelho não tem nenhuma vistoria. */
    empty: total === 0,
    /** "6 vistorias", ou "50 de 10.000 vistorias" com a lista cortada. */
    count: countLabel(rows.length, total),
    /** Quantas vistorias ainda não estão na lista. */
    hidden: total - rows.length,
    showMore() {
      setLimit((current) => current + LIST_PAGE_SIZE);
    },
    rows: rows.map((row) => ({
      id: row.id,
      deletable: isDeletable(row),
      deleting: row.sync === "excluindo",
      deleteSubject: deletionSubject(row.address ?? "Imóvel fora deste aparelho", row.kindLabel),
      unsent: hasUnsent(row.sync),
      // Em conflito, a linha abre o ConflictResolver (Figma SyncBadge 25:1053).
      href: row.sync === "conflito" ? conflictHref(row.id) : inspectionHref(row.id),
      address: row.address ?? "Imóvel fora deste aparelho",
      clientName: row.clientName,
      kindLabel: row.kindLabel,
      statusLabel: row.statusLabel,
      completed: row.status === "completed",
      // O laudo só da conclusão confirmada: concluída e sem nada na fila (ADR 0054).
      reportHref:
        row.status === "completed" && row.sync === "sincronizado" ? reportHref(row.id) : null,
      startedOn: dateOf(row.startedAt),
      startedMeta: startedLabel(row.startedAt),
      sync: row.sync,
    })),
    remove(id: string) {
      if (store) void deleteInspection(store, id);
    },
  };
}
