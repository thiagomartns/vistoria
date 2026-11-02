import { useSyncExternalStore } from "react";

import type { LocalStore } from "@/features/local-store/services/local-store";

import type { InspectionSummary } from "../models/inspection-summary";

const NOTHING = { ready: false, rows: [] as readonly InspectionSummary[] };
const idle = () => () => {};

/** O resumo de cada vistoria confirmada: o que a lista lê, sem abrir as vistorias completas (ADR 0048). */
export function useInspectionSummaries(store: LocalStore | undefined) {
  const summaries = store?.inspectionSummaries;
  const snapshot = useSyncExternalStore(
    summaries?.subscribe ?? idle,
    summaries?.getSnapshot ?? (() => NOTHING),
    () => NOTHING,
  );
  return { data: snapshot.rows, isReady: snapshot.ready };
}
