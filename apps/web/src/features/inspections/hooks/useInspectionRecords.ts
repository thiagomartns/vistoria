import { inArray } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";

import type { LocalStore } from "@/features/local-store/services/local-store";

import type { InspectionRecord } from "../models/inspection";

const NONE: InspectionRecord[] = [];

/**
 * As vistorias completas de `ids`, com o que está na fila por cima, como o `useInspectionRecord` faz com uma: a
 * collection de vistorias só carrega por id (ADR 0048). Sem ids, não consulta. `ready` quando a leitura terminou.
 */
export function useInspectionRecords(store: LocalStore | undefined, ids: readonly string[]) {
  const query = useLiveQuery((q) =>
    store && ids.length > 0
      ? q
          .from({ inspection: store.inspections })
          .where(({ inspection }) => inArray(inspection.id, [...ids]))
      : undefined,
  );
  return {
    records: ids.length > 0 ? ((query.data ?? NONE) as InspectionRecord[]) : NONE,
    ready: ids.length === 0 || (store !== undefined && query.isReady),
  };
}
