import type { ClientRecord } from "@/features/clients/models/client";
import { formatDocument } from "@/features/clients/schemas/client.schemas";
import type { PropertyRecord } from "@/features/properties/models/property";
import { PROPERTY_TYPES, formatZipCode } from "@/features/properties/schemas/property.schemas";
import { addressOf } from "@/features/properties/services/properties.view";
import type { InspectionSnapshotDto } from "@/shared/api/generated";

import type { InspectionRecord } from "../models/inspection";
import type { ReportField, ReportNotice, ReportView } from "../models/inspection-report";
import { CONDITIONS } from "../schemas/inspection.schemas";
import { referenceOf } from "./inspections.view";

// Do banco local para o laudo de /inspections/report (Figma 177:16524). Função pura: cada estado cabe num teste, e a
// folha recebe só o resultado. O laudo é prova (vision.md, H9): só existe para a conclusão que o servidor confirmou,
// com a data, quem concluiu e a cópia do imóvel e do cliente gravados por ele (ADR 0050, 0053, 0054 e 0068).

/** Os avisos sem laudo (Figma 177:16524, estados 4 a 6). */
export const REPORT_NOTICES = {
  pending: {
    tone: "warning",
    title: "O laudo fica disponível quando a conclusão for enviada",
    description:
      "A vistoria foi concluída neste aparelho e está na fila. O laudo usa a data e o vistoriador registrados pelo servidor.",
  },
  inProgress: {
    tone: "neutral",
    title: "Esta vistoria ainda não foi concluída",
    description: "O laudo só existe para a vistoria concluída. Conclua a vistoria na tela de campo.",
  },
  notFound: {
    tone: "neutral",
    title: "Vistoria não encontrada",
    description: "Ela não está neste aparelho. Confira o link ou abra pela lista de vistorias.",
  },
} as const satisfies Record<string, ReportNotice>;

const DATE = new Intl.DateTimeFormat("pt-BR");
const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "19/10/2026 às 11:47", ou `null` sem data válida. */
function dateAndTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `${DATE.format(date)} às ${TIME.format(date)}`;
}

/** "CNPJ 12.345.678/0001-90" ou "CPF 123.456.789-09"; outro formato vai como está. */
function documentOf(document: string): string {
  const formatted = formatDocument(document);
  if (/^\d{11}$/.test(document)) return `CPF ${formatted}`;
  if (/^[0-9A-Z]{12}\d{2}$/.test(document)) return `CNPJ ${formatted}`;
  return formatted;
}

/** O imóvel de que o laudo precisa: o registro do aparelho ou a cópia da conclusão. */
type ReportProperty = InspectionSnapshotDto["property"];

/** O cliente de que o laudo precisa: o registro do aparelho ou a cópia da conclusão. */
type ReportClient = InspectionSnapshotDto["client"];

/** "Rua das Flores, 120 · ap 32 · Jardim Paulista · São Paulo/SP · 01400-000". */
function fullAddressOf(property: ReportProperty): string {
  return [
    addressOf(property),
    property.district,
    `${property.city}/${property.state}`,
    formatZipCode(property.zipCode),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Concluída por Thiago Martins em 19/10/2026 às 11:47 (registrada pelo servidor)". */
function completionOf(inspection: InspectionRecord): string {
  const author = inspection.completedBy?.name;
  const when = dateAndTime(inspection.completedAt);
  const sentence = ["Concluída", author && `por ${author}`, when && `em ${when}`].filter(Boolean).join(" ");
  return `${sentence} (registrada pelo servidor)`;
}

/** "Imobiliária Horizonte · CNPJ 12.345.678/0001-90". */
const clientOf = (client: ReportClient): string =>
  [client.name, client.document && documentOf(client.document)].filter(Boolean).join(" · ");

/** O campo "Entrada" da saída: a data e o id da entrada e, se a cópia dela tem outro endereço, ele na segunda linha. */
function moveInOf(inspection: InspectionRecord, referenceId: string, reference?: InspectionRecord): ReportField {
  const when = dateAndTime(reference?.completedAt);
  const field: ReportField = {
    label: "Entrada",
    value: [when && `Laudo de entrada de ${when}`, referenceId].filter(Boolean).join(" · "),
  };
  const then = reference?.completedSnapshot?.property;
  const now = inspection.completedSnapshot?.property;
  if (then && now && fullAddressOf(then) !== fullAddressOf(now)) {
    field.detail = `Endereço na entrada: ${fullAddressOf(then)}`;
  }
  return field;
}

/**
 * O laudo da vistoria `inspection` (o registro com a fila por cima). O imóvel e o cliente vêm da cópia que o servidor
 * gravou na conclusão (ADR 0068): o laudo não muda quando eles mudam, e abre sem eles no aparelho. Uma concluída que
 * ainda não recebeu a cópia (antes do pull que a traz) usa o imóvel e o cliente do aparelho. A conclusão confirmada é a
 * que tem o `completedAt`, que só o servidor grava (ADR 0050): concluída sem ele, a conclusão ainda está na fila.
 * `reference`: a entrada de uma saída, quando o aparelho a tem.
 */
export function reportView(
  inspection: InspectionRecord | undefined,
  {
    property,
    client,
    reference,
  }: {
    property?: PropertyRecord;
    client?: ClientRecord;
    reference?: InspectionRecord;
  } = {},
): ReportView {
  if (!inspection || inspection.deleting) return { state: "notFound", notice: REPORT_NOTICES.notFound };
  if (inspection.status !== "completed") return { state: "inProgress", notice: REPORT_NOTICES.inProgress };
  if (!inspection.completedAt) return { state: "pending", notice: REPORT_NOTICES.pending };

  const kind = inspection.kind;
  const copied = inspection.completedSnapshot;
  const place: ReportProperty | undefined = copied?.property ?? property;
  const owner: ReportClient | undefined = copied?.client ?? client;
  const fields: ReportField[] = [
    { label: "Imóvel", value: place ? fullAddressOf(place) : "—" },
    { label: "Tipo de imóvel", value: place ? PROPERTY_TYPES[place.type] : "—" },
    { label: "Cliente", value: owner ? clientOf(owner) : "—" },
    { label: "Início", value: dateAndTime(inspection.startedAt) ?? "—" },
    { label: "Conclusão", value: completionOf(inspection) },
  ];
  if (inspection.referenceInspectionId) {
    fields.push(moveInOf(inspection, inspection.referenceInspectionId, reference));
  }
  fields.push({ label: "Identificação", value: `${inspection.id} · versão ${inspection.version}` });

  return {
    state: "report",
    report: {
      kind,
      title: `Laudo de vistoria de ${kind === "moveOut" ? "saída" : "entrada"}`,
      fields,
      rooms: inspection.rooms.map((room, index) => ({
        id: room.id,
        title: `${index + 1}. ${room.name}`,
        items: room.items.map((item) => {
          const copy = referenceOf(item);
          return {
            id: item.id,
            name: item.name,
            condition: item.condition ? CONDITIONS[item.condition] : "—",
            notes: item.notes,
            ...(copy && { reference: copy }),
          };
        }),
      })),
      generalNotes: inspection.generalNotes,
    },
  };
}
