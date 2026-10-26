import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import { FIXED_TEMPLATE, newMoveInInspection } from "../services/inspections.factory";
import { saveInspection } from "../services/inspections.sync";
import { inspectionHref, placesOf } from "./useInspections";

const newInspectionSchema = z.object({
  propertyId: z.string().min(1, "Escolha o imóvel."),
});

export type NewInspectionValues = z.infer<typeof newInspectionSchema>;

const rooms = FIXED_TEMPLATE.length;
const items = FIXED_TEMPLATE.reduce((total, room) => total + room.items.length, 0);

/** "Roteiro padrão · 5 ambientes, 29 itens": o roteiro fixo até os roteiros editáveis (M5). */
export const TEMPLATE_LABEL = `Roteiro padrão · ${rooms} ambientes, ${items} itens`;

/**
 * O formulário de /inspections/new (wireframe 68:1644): escolhe um imóvel do aparelho e cria a vistoria de entrada
 * pelo roteiro fixo, no banco local e na fila, mesmo offline. Depois abre a tela de campo no primeiro ambiente.
 */
export function useNewInspection() {
  const router = useRouter();
  const { store, ready, properties, clients } = useLocalStore();
  const places = placesOf(properties, clients);

  const form = useForm<NewInspectionValues>({
    resolver: zodResolver(newInspectionSchema),
    defaultValues: { propertyId: "" },
  });

  const onSubmit = form.handleSubmit(({ propertyId }) => {
    if (!store) return;
    const id = saveInspection(store, newMoveInInspection(propertyId));
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
  };
}
