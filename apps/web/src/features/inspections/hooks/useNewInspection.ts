import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import {
  FIXED_TEMPLATE,
  newMoveInInspection,
  newMoveOutInspection,
} from "../services/inspections.factory";
import { DELETE_INSPECTION, UPSERT_INSPECTION, saveInspection } from "../services/inspections.sync";
import { moveInsOf } from "../services/inspections.view";
import { useInspectionRecord } from "./useInspectionRecord";
import { useInspectionSummaries } from "./useInspectionSummaries";
import { inspectionHref, placesOf } from "./useInspections";

const newInspectionSchema = z.object({
  propertyId: z.string().min(1, "Escolha o imóvel."),
  kind: z.enum(["moveIn", "moveOut"]),
  /** A entrada escolhida na saída; "" (ou uma que não é do imóvel) vale a mais recente dele. */
  moveInId: z.string(),
});

export type NewInspectionValues = z.infer<typeof newInspectionSchema>;

const rooms = FIXED_TEMPLATE.length;
const items = FIXED_TEMPLATE.reduce((total, room) => total + room.items.length, 0);

/** "Roteiro padrão · 5 ambientes, 29 itens": o roteiro fixo até os roteiros editáveis (M5). */
export const TEMPLATE_LABEL = `Roteiro padrão · ${rooms} ambientes, ${items} itens`;

/**
 * O formulário de /inspections/new (wireframes 68:1644 e 68:1878): escolhe um imóvel do aparelho e o tipo. A entrada
 * parte do roteiro fixo; a saída, de uma entrada concluída do imóvel que o aparelho tem (a mais recente vem
 * escolhida), lida inteira do banco local para a cópia. As duas nascem no banco local e na fila, mesmo offline, e
 * abrem a tela de campo no primeiro ambiente.
 */
export function useNewInspection() {
  const router = useRouter();
  const { store, ready, properties, clients, pending, outboxRead } = useLocalStore();
  const summaries = useInspectionSummaries(store);
  const places = placesOf(properties, clients);

  const form = useForm<NewInspectionValues>({
    resolver: zodResolver(newInspectionSchema),
    defaultValues: { propertyId: "", kind: "moveIn", moveInId: "" },
  });
  const [propertyId, kind, moveInId] = useWatch({
    control: form.control,
    name: ["propertyId", "kind", "moveInId"],
  });

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
        : newMoveInInspection(values.propertyId);
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
    templateLabel: TEMPLATE_LABEL,
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
