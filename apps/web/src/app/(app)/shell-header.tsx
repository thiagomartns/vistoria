"use client";

import { createContext, useContext, useEffect } from "react";

import type { SyncBadgeState } from "@/shared/components/sync-badge";

// O header do shell mostra o título da rota. Uma tela de registro (Figma "/clients/edit", 70:2719) troca o título
// pelo do registro, ganha "Voltar" e o SyncBadge do registro (só no desktop: no celular falta espaço, nota 70:2993).
// A tela declara isso com <PageHeader />; o shell desenha.

export interface ShellHeader {
  title: string;
  /** Para onde o "Voltar" leva. */
  backHref?: string;
  /** Estado de sync do registro, no SyncBadge ao lado do título (desktop). */
  sync?: SyncBadgeState;
}

export const ShellHeaderContext = createContext<(header: ShellHeader | null) => void>(() => {});

/** Troca o header do shell enquanto a tela está aberta. Não desenha nada no lugar. */
export function PageHeader({ title, backHref, sync }: ShellHeader) {
  const setHeader = useContext(ShellHeaderContext);

  useEffect(() => {
    setHeader({ title, backHref, sync });
  }, [setHeader, title, backHref, sync]);

  useEffect(() => () => setHeader(null), [setHeader]);

  return null;
}
