import type { ClientRecord } from "@/features/clients/models/client";
import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { PropertyRecord } from "@/features/properties/models/property";
import { addressOf } from "@/features/properties/services/properties.view";

import { conflictHref } from "../services/inspections.resolve";
import { type PlaceView, dateOf, inspectionRows, startedLabel } from "../services/inspections.view";

/** A lista; para onde "Voltar" e "Cancelar" levam. */
export const INSPECTIONS_HREF = "/inspections";

/** A tela de campo de uma vistoria. */
export const inspectionHref = (id: string) => `/inspections/edit?id=${encodeURIComponent(id)}`;

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
 * tela de campo, ou o ConflictResolver quando a vistoria está em conflito.
 */
export function useInspections() {
  const { ready, inspections, properties, clients, drafts, states } = useLocalStore();
  const rows = inspectionRows(inspections, drafts, states, placesOf(properties, clients));
  return {
    ready,
    /** O aparelho não tem nenhuma vistoria. */
    empty: rows.length === 0,
    /** "6 vistorias". */
    count: `${rows.length} ${rows.length === 1 ? "vistoria" : "vistorias"}`,
    rows: rows.map((row) => ({
      id: row.id,
      // Em conflito, a linha abre o ConflictResolver (Figma SyncBadge 25:1053).
      href: row.sync === "conflito" ? conflictHref(row.id) : inspectionHref(row.id),
      address: row.address ?? "Imóvel fora deste aparelho",
      clientName: row.clientName,
      kindLabel: row.kindLabel,
      statusLabel: row.statusLabel,
      completed: row.status === "completed",
      startedOn: dateOf(row.startedAt),
      startedMeta: startedLabel(row.startedAt),
      sync: row.sync,
    })),
  };
}
