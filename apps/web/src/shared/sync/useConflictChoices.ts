import { useState } from "react";

import type { ConflictChoice } from "./flat-conflict";

// As escolhas de um ConflictResolver, iguais para vistoria, cliente e imóvel: "meu" ou "servidor" por campo, o resumo e
// o envio. As escolhas vivem só na tela: sair sem enviar deixa o conflito como estava.

/** O resumo quando o que estava em disputa ficou igual dos dois lados depois do conflito. */
export const NOTHING_LEFT = "Nada mais em disputa: o que só um lado mudou já foi mesclado.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Neste aparelho · 15:02"; sem a hora, só a origem. */
export function conflictOrigin(label: string, at: string | undefined): string {
  const date = at ? new Date(at) : undefined;
  if (!date || Number.isNaN(date.getTime())) return label;
  return `${label} · ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** As escolhas sobre os campos de `keys` (as chaves das colisões) e o envio da resolução. */
export function useConflictChoices(keys: readonly string[]) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const chosen = keys.filter((key) => choices[key] !== undefined).length;
  const left = keys.length - chosen;

  /** Envia a resolução por `send`. Devolve `true` quando ela saiu (ou só adotou o servidor). */
  async function submit(
    send: (choices: Readonly<Record<string, ConflictChoice>>) => Promise<void>,
  ): Promise<boolean> {
    if (left > 0 || submitting) return false;
    setSubmitting(true);
    try {
      await send(choices);
      setDone(true);
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  return {
    choices,
    /** A resolução saiu e o rascunho já não está em conflito; a tela só sai. */
    done,
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
