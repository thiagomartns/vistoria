import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import { reportView } from "../services/inspections.report";
import { useInspectionRecord } from "./useInspectionRecord";

/**
 * O laudo de `id` (/inspections/report, Figma 177:16524), só do banco local: abre offline, e uma vistoria que o
 * aparelho não tem é "não encontrada", sem `GET`. Na saída, lê também a entrada de referência, para a data dela.
 * `ready` quando a leitura terminou.
 */
export function useInspectionReport(id: string | null) {
  const { store, ready: storeReady, properties, clients } = useLocalStore();
  const { record, ready } = useInspectionRecord(store, id);
  const reference = useInspectionRecord(store, record?.referenceInspectionId ?? null);
  const property = record ? properties.find((each) => each.id === record.propertyId) : undefined;
  const client = property ? clients.find((each) => each.id === property.clientId) : undefined;
  return {
    ready: storeReady && ready && reference.ready,
    view: reportView(record, { property, client, reference: reference.record }),
  };
}
