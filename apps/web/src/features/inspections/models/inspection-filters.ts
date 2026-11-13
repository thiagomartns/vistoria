import type { InspectionKind, InspectionStatus } from "./inspection";

// A busca e os filtros da lista de vistorias (#175, Figma "Busca e filtros (#175)"). Ficam na URL de /inspections, para
// o "Voltar" da tela de campo e do laudo devolver a lista filtrada.

/** O período pela data de início: os últimos N dias, contando hoje. */
export type InspectionPeriod = "7d" | "30d" | "12m";

export const INSPECTION_PERIODS: Record<InspectionPeriod, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "12m": "Últimos 12 meses",
};

/** A busca e os filtros; `null` é "todos" (ou "qualquer data"). */
export interface InspectionFilters {
  /** O texto da busca, como foi digitado. */
  query: string;
  clientId: string | null;
  propertyId: string | null;
  kind: InspectionKind | null;
  status: InspectionStatus | null;
  period: InspectionPeriod | null;
}

export const NO_FILTERS: InspectionFilters = {
  query: "",
  clientId: null,
  propertyId: null,
  kind: null,
  status: null,
  period: null,
};

/** Os parâmetros da URL, na ordem em que saem. */
const PARAMS = {
  query: "q",
  clientId: "cliente",
  propertyId: "imovel",
  kind: "tipo",
  status: "status",
  period: "periodo",
} as const satisfies Record<keyof InspectionFilters, string>;

const KINDS: readonly InspectionKind[] = ["moveIn", "moveOut"];
const STATUSES: readonly InspectionStatus[] = ["inProgress", "completed"];

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | null =>
  value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;

const nonEmpty = (value: string | null): string | null => (value ? value : null);

/** Os filtros de uma URL; valor que não existe vira "todos". */
export function filtersFromParams(params: Pick<URLSearchParams, "get">): InspectionFilters {
  return {
    query: params.get(PARAMS.query) ?? "",
    clientId: nonEmpty(params.get(PARAMS.clientId)),
    propertyId: nonEmpty(params.get(PARAMS.propertyId)),
    kind: oneOf(KINDS, params.get(PARAMS.kind)),
    status: oneOf(STATUSES, params.get(PARAMS.status)),
    period: oneOf(Object.keys(INSPECTION_PERIODS) as InspectionPeriod[], params.get(PARAMS.period)),
  };
}

/** A query string dos filtros, sem o "?"; vazia sem filtro nenhum. */
export function filtersToSearch(filters: InspectionFilters): string {
  const params = new URLSearchParams();
  for (const [field, name] of Object.entries(PARAMS) as [keyof InspectionFilters, string][]) {
    const value = filters[field];
    if (value) params.set(name, value);
  }
  return params.toString();
}

/** Quantos filtros estão ligados, sem a busca ("Filtros · N" no celular). */
export function activeFilterCount(filters: InspectionFilters): number {
  return [
    filters.clientId,
    filters.propertyId,
    filters.kind,
    filters.status,
    filters.period,
  ].filter((value) => value !== null).length;
}

/** A busca tem texto ou algum filtro está ligado. */
export const isFiltered = (filters: InspectionFilters): boolean =>
  filters.query.trim() !== "" || activeFilterCount(filters) > 0;
