import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { addressOf } from "@/features/properties/services/properties.view";

import { newMoveInInspection } from "../services/inspections.factory";
import { saveInspection } from "../services/inspections.sync";
import { inspectionRows } from "../services/inspections.view";

/**
 * As vistorias do banco local, com o endereço do imóvel e o estado de sync, e a criação de uma vistoria de entrada a
 * partir do roteiro fixo.
 */
export function useInspections() {
  const { store, ready, inspections, properties, drafts, states } = useLocalStore();

  const addresses = new Map(properties.map((property) => [property.id, addressOf(property)]));
  const rows = inspectionRows(inspections, drafts, states, addresses);
  return {
    ready,
    /** O aparelho não tem nenhuma vistoria. */
    empty: rows.length === 0,
    rows,
    /** Cria uma vistoria de entrada para o imóvel e devolve o id; sem o banco aberto, `undefined`. */
    create(propertyId: string): string | undefined {
      if (!store) return undefined;
      return saveInspection(store, newMoveInInspection(propertyId));
    },
  };
}
