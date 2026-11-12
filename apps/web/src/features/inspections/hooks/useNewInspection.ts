import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { templateRows } from "@/features/templates/services/templates.view";

import { newMoveInInspection, newMoveOutInspection } from "../services/inspections.factory";
import { DELETE_INSPECTION, UPSERT_INSPECTION, saveInspection } from "../services/inspections.sync";
import { DEFAULT_TEMPLATE_ID, moveInsOf, templateOptionsOf } from "../services/inspections.view";
import { useInspectionRecord } from "./useInspectionRecord";
import { useInspectionSummaries } from "./useInspectionSummaries";
import { inspectionHref, placesOf } from "./useInspections";

const newInspectionSchema = z.object({
  propertyId: z.string().min(1, "Escolha o imóvel."),
  kind: z.enum(["moveIn", "moveOut"]),
  /** A entrada escolhida na saída; "" (ou uma que não é do imóvel) vale a mais recente dele. */
  moveInId: z.string(),
  /** O roteiro escolhido na entrada; "" (ou um que o aparelho não tem mais) vale o primeiro da lista. */
  templateId: z.string(),
});

export type NewInspectionValues = z.infer<typeof newInspectionSchema>;

/**
 * O formulário de /inspections/new (wireframes 68:1644 e 68:1878, e a seção "Nova vistoria · roteiro (#174)"): escolhe
 * um imóvel do aparelho e o tipo. A entrada parte de um roteiro do aparelho (os da lista de roteiros, com os da fila e
 * os rascunhos, o primeiro por nome já escolhido), ou do roteiro padrão num aparelho sem nenhum; a saída, de uma entrada concluída do imóvel que o aparelho tem (a mais recente vem
 * escolhida), lida inteira do banco local para a cópia. As duas nascem no banco local e na fila, mesmo offline, e
 * abrem a tela de campo no primeiro ambiente.
 */
export function useNewInspection() {
  const router = useRouter();
  const { store, ready, properties, clients, templates, drafts, states, pending, outboxRead } =
    useLocalStore();
  const summaries = useInspectionSummaries(store);
  const places = placesOf(properties, clients);

  const form = useForm<NewInspectionValues>({
    resolver: zodResolver(newInspectionSchema),
    defaultValues: { propertyId: "", kind: "moveIn", moveInId: "", templateId: "" },
  });
  const [propertyId, kind, moveInId, templateId] = useWatch({
    control: form.control,
    name: ["propertyId", "kind", "moveInId", "templateId"],
  });

  const templateOptions = templateOptionsOf(templateRows(templates, drafts, states));
  const template =
    templateOptions.find((option) => option.value === templateId) ?? templateOptions[0];

  // As vistorias da fila, por cima dos resumos: a entrada concluída offline já conta.
  const queued = new Map(
    [...pending].filter(
      ([, entry]) =>
        entry.mutationFnName === UPSERT_INSPECTION || entry.mutationFnName === DELETE_INSPECTION,
    ),
  );
  const moveInsReady = summaries.isReady && outboxRead;
  const moveIns = propertyId && moveInsReady ? moveInsOf(summaries.data, queued, propertyId) : [];
  const chosen = moveIns.some((option) => option.value === moveInId)
    ? moveInId
    : (moveIns[0]?.value ?? "");
  const moveOut = kind === "moveOut";
  const { record: moveIn } = useInspectionRecord(store, moveOut && chosen ? chosen : null);

  const onSubmit = form.handleSubmit((values) => {
    if (!store) return;
    if (values.kind === "moveOut" && !moveIn) return;
    const inspection =
      values.kind === "moveOut" && moveIn
        ? newMoveOutInspection(moveIn)
        : newMoveInInspection(values.propertyId, template.rooms);
    const id = saveInspection(store, inspection);
    router.push(inspectionHref(id));
  });

  return {
    ready,
    form,
    onSubmit,
    /** "Rua das Flores, 120 · ap 32 · Imobiliária Horizonte", em ordem de endereço. */
    propertyOptions: [...places]
      .map(([value, place]) => ({
        value,
        label: [place.address, place.clientName].filter(Boolean).join(" · "),
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    /** Os roteiros do aparelho que servem de molde, ou só o roteiro padrão. */
    templateOptions: templateOptions.map(({ value, label }) => ({ value, label })),
    /** O roteiro de onde a entrada parte: o escolhido, ou o primeiro. */
    templateId: template.value,
    /** O aparelho não tem roteiro que sirva: a opção é o roteiro padrão. */
    defaultTemplate: templateOptions.every((option) => option.value === DEFAULT_TEMPLATE_ID),
    /** O tipo escolhido é saída. */
    moveOut,
    /** As entradas concluídas do imóvel escolhido, da mais recente para a mais antiga. */
    moveInOptions: moveIns,
    /** A entrada de onde a saída parte: a escolhida, ou a mais recente. */
    moveInId: chosen,
    /** Saída num imóvel sem entrada concluída no aparelho (wireframe 68:1759). */
    noMoveIn: moveOut && propertyId !== "" && moveInsReady && moveIns.length === 0,
    /** A saída espera a entrada escolhida ser lida inteira do banco local. */
    waitingMoveIn: moveOut && (chosen === "" || moveIn === undefined),
  };
}
