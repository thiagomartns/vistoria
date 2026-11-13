import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { templateRows } from "@/features/templates/services/templates.view";

import { newMoveInInspection, newMoveOutInspection } from "../services/inspections.factory";
import { DELETE_INSPECTION, UPSERT_INSPECTION, saveInspection } from "../services/inspections.sync";
import {
  DEFAULT_TEMPLATE_ID,
  defaultMoveInOf,
  moveInsOf,
  moveOutIdsOf,
  templateOptionsOf,
  withMoveOutOf,
} from "../services/inspections.view";
import { useInspectionRecord } from "./useInspectionRecord";
import { useInspectionRecords } from "./useInspectionRecords";
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
 * escolhida), lida inteira do banco local para a cópia. A entrada que já tem saída no aparelho diz isso no Select, a
 * escolhida por padrão é a mais recente sem saída, e começar outra saída dela pede confirmação (#184, ADR 0059). As
 * duas nascem no banco local e na fila, mesmo offline, e
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
  const summariesReady = summaries.isReady && outboxRead;
  const moveOut = kind === "moveOut";
  // As saídas do imóvel, lidas inteiras por id: o resumo não guarda de que entrada cada uma partiu (ADR 0059).
  const moveOutIds =
    moveOut && propertyId && summariesReady ? moveOutIdsOf(summaries.data, queued, propertyId) : [];
  const moveOuts = useInspectionRecords(store, moveOutIds);
  const moveInsReady = summariesReady && moveOuts.ready;
  const moveIns =
    propertyId && moveInsReady
      ? moveInsOf(summaries.data, queued, propertyId, withMoveOutOf(moveOuts.records))
      : [];
  const chosenOption =
    moveIns.find((option) => option.value === moveInId) ?? defaultMoveInOf(moveIns);
  const chosen = chosenOption?.value ?? "";
  const { record: moveIn } = useInspectionRecord(store, moveOut && chosen ? chosen : null);
  const [confirming, setConfirming] = useState(false);

  const create = (values: NewInspectionValues) => {
    if (!store) return;
    if (values.kind === "moveOut" && !moveIn) return;
    const inspection =
      values.kind === "moveOut" && moveIn
        ? newMoveOutInspection(moveIn)
        : newMoveInInspection(values.propertyId, template.rooms);
    const id = saveInspection(store, inspection);
    router.push(inspectionHref(id));
  };

  const onSubmit = form.handleSubmit((values) => {
    // Outra saída da mesma entrada é quase sempre engano: pergunta antes (#184).
    if (values.kind === "moveOut" && chosenOption?.hasMoveOut) setConfirming(true);
    else create(values);
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
    /** A entrada de onde a saída parte: a escolhida, ou a mais recente sem saída. */
    moveInId: chosen,
    /** A escolhida já tem saída no aparelho (#184). */
    chosenHasMoveOut: chosenOption?.hasMoveOut ?? false,
    /** Saída num imóvel sem entrada concluída no aparelho (wireframe 68:1759). */
    noMoveIn: moveOut && propertyId !== "" && moveInsReady && moveIns.length === 0,
    /** A saída espera a entrada escolhida ser lida inteira do banco local. */
    waitingMoveIn: moveOut && (chosen === "" || moveIn === undefined),
    /** A confirmação de começar outra saída de uma entrada que já tem saída. */
    confirmMoveOut: {
      open: confirming,
      onOpenChange: setConfirming,
      /** "Entrada de 20/10/2026 às 14:30", sem o total de itens nem a marca. */
      subject: chosenOption?.label.split(" · ")[0] ?? "",
      onConfirm: () => create(form.getValues()),
    },
  };
}
