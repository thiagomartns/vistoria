import type { ClientRecord } from "@/features/clients/models/client";
import { formatDocument } from "@/features/clients/schemas/client.schemas";
import type { PropertyRecord } from "@/features/properties/models/property";
import { PROPERTY_TYPES, formatZipCode } from "@/features/properties/schemas/property.schemas";
import { addressOf } from "@/features/properties/services/properties.view";

import type { InspectionRecord } from "../models/inspection";
import type { ReportField, ReportNotice, ReportView } from "../models/inspection-report";
import { CONDITIONS } from "../schemas/inspection.schemas";
import { referenceOf } from "./inspections.view";

// Do banco local para o laudo de /inspections/report (Figma 177:16524). Função pura: cada estado cabe num teste, e a
// folha recebe só o resultado. O laudo é prova (vision.md, H9): só existe para a conclusão que o servidor confirmou,
// com a data e quem concluiu gravados por ele (ADR 0050, 0053 e 0054).

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

/** "Rua das Flores, 120 · ap 32 · Jardim Paulista · São Paulo/SP · 01400-000". */
function fullAddressOf(property: PropertyRecord): string {
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

/**
 * O laudo da vistoria `inspection` (o registro com a fila por cima), com o imóvel e o cliente do aparelho. A conclusão
 * confirmada é a que tem o `completedAt`, que só o servidor grava (ADR 0050): concluída sem ele, a conclusão ainda está
 * na fila. `reference`: a entrada de uma saída, quando o aparelho a tem.
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
  const fields: ReportField[] = [
    { label: "Imóvel", value: property ? fullAddressOf(property) : "—" },
    { label: "Tipo de imóvel", value: property ? PROPERTY_TYPES[property.type] : "—" },
    {
      label: "Cliente",
      value: client
        ? [client.name, client.document && documentOf(client.document)].filter(Boolean).join(" · ")
        : "—",
    },
    { label: "Início", value: dateAndTime(inspection.startedAt) ?? "—" },
    { label: "Conclusão", value: completionOf(inspection) },
  ];
  if (inspection.referenceInspectionId) {
    const when = dateAndTime(reference?.completedAt);
    fields.push({
      label: "Entrada",
      value: [when && `Laudo de entrada de ${when}`, inspection.referenceInspectionId]
        .filter(Boolean)
        .join(" · "),
    });
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
