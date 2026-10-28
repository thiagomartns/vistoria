import { useState } from "react";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import { INSPECTION_ENTITY } from "../models/inspection";
import {
  type ConflictChoice,
  inspectionConflictOf,
  resolveInspection,
} from "../services/inspections.resolve";
import { resolveInspectionConflict } from "../services/inspections.sync";
import { conflictGroups, fieldHeader } from "../services/inspections.view";
import { placesOf } from "./useInspections";

/** O resumo quando o que estava em disputa ficou igual dos dois lados depois do conflito. */
export const NOTHING_LEFT = "Nada mais em disputa: o que só um lado mudou já foi mesclado.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Neste aparelho · 15:02"; sem a hora, só a origem. */
function origin(label: string, at: string | undefined): string {
  const date = at ? new Date(at) : undefined;
  if (!date || Number.isNaN(date.getTime())) return label;
  return `${label} · ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * O ConflictResolver de uma vistoria (frontend.md, "Conflito"): o merge refeito a partir do rascunho em conflito, as
 * escolhas da pessoa ("meu" ou "servidor" por campo) e o envio da resolução. As escolhas vivem só na tela: sair sem
 * enviar deixa o conflito como estava.
 */
export function useInspectionConflict(id: string | null) {
  const { store, ready, inspections, properties, clients, drafts } = useLocalStore();
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const draft = id
    ? drafts.find((candidate) => candidate.id === id && candidate.entity === INSPECTION_ENTITY)
    : undefined;
  const conflict = inspectionConflictOf(draft);
  const places = placesOf(properties, clients);
  const groups = conflict ? conflictGroups(conflict, places) : [];
  const keys = groups.flatMap((group) => group.fields.map((field) => field.key));
  const chosen = keys.filter((key) => choices[key] !== undefined).length;
  const left = keys.length - chosen;
  const header = conflict
    ? fieldHeader(conflict.local, places.get(conflict.local.propertyId))
    : undefined;

  /** Envia a resolução. Devolve `true` quando ela saiu (ou só adotou o servidor). */
  async function submit(): Promise<boolean> {
    if (!store || !conflict || left > 0 || submitting) return false;
    setSubmitting(true);
    try {
      await resolveInspectionConflict(store, {
        resolved: resolveInspection(conflict, choices),
        server: conflict.server,
      });
      setDone(true);
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  return {
    /** `done`: a resolução saiu e o rascunho já não está em conflito; a tela só sai. */
    status: done
      ? ("done" as const)
      : !ready
        ? ("loading" as const)
        : conflict
          ? ("found" as const)
          : ("none" as const),
    /** A vistoria existe neste aparelho (para "Abrir a vistoria" quando não há conflito). */
    known: id !== null && (draft !== undefined || inspections.some((entry) => entry.id === id)),
    description: header
      ? `${header.title} · ${header.compactSubtitle}. Ela foi alterada em outro aparelho enquanto você editava. O que só um lado mudou já foi mesclado; escolha o valor que fica em cada campo abaixo.`
      : "",
    mineOrigin: origin("Neste aparelho", conflict?.localAt),
    theirsOrigin: origin("No servidor", conflict?.serverAt),
    groups: groups.map((group) => ({
      ...group,
      fields: group.fields.map((field) => ({ ...field, choice: choices[field.key] })),
    })),
    /** "1 de 3 campos resolvidos". */
    summary:
      keys.length === 0
        ? NOTHING_LEFT
        : `${chosen} de ${plural(keys.length, "campo resolvido", "campos resolvidos")}`,
    /** "Faltam 2 campos". */
    remaining:
      left === 0 ? "Tudo escolhido" : left === 1 ? "Falta 1 campo" : `Faltam ${left} campos`,
    canSubmit: left === 0,
    submitting,
    choose: (key: string, choice: ConflictChoice) =>
      setChoices((current) => ({ ...current, [key]: choice })),
    chooseAll: (choice: ConflictChoice) =>
      setChoices(Object.fromEntries(keys.map((key) => [key, choice]))),
    submit,
  };
}
