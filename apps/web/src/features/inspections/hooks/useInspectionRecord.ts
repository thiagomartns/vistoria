import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";

import type { LocalStore } from "@/features/local-store/services/local-store";

import type { InspectionRecord } from "../models/inspection";

/**
 * A vistoria completa de `id`, com o que está na fila por cima: a collection de vistorias só carrega por id, e esta
 * consulta carrega só ela (ADR 0048). `ready` quando a leitura terminou, tenha ela achado a vistoria ou não.
 */
export function useInspectionRecord(store: LocalStore | undefined, id: string | null) {
  const query = useLiveQuery(
    (q) =>
      store && id
        ? q
            .from({ inspection: store.inspections })
            .where(({ inspection }) => eq(inspection.id, id))
            .findOne()
        : undefined,
  );
  return {
    record: query.data as InspectionRecord | undefined,
    ready: id === null || (store !== undefined && query.isReady),
  };
}
