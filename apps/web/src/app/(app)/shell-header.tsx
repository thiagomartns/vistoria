"use client";

import { type ReactNode, createContext, useContext, useEffect } from "react";

import type { SyncBadgeState } from "@/shared/components/sync-badge";

// O header do shell mostra o título da rota. Uma tela de registro (Figma "/clients/edit", 70:2719) troca o título
// pelo do registro, ganha "Voltar" e o SyncBadge do registro (só no desktop: no celular falta espaço, nota 70:2993).
// A tela de campo (Figma 43:1751) soma um subtítulo e o modo foco: no celular, sem a barra inferior nem o avatar, e
// sem o respiro do conteúdo, que ela desenha de ponta a ponta, e o "···" de ações antes do SyncStatus (#107). A tela
// declara isso com <PageHeader />; o shell desenha.

export interface ShellHeader {
  title: string;
  /** Para onde o "Voltar" leva. */
  backHref?: string;
  /** Estado de sync do registro, no SyncBadge ao lado do título (desktop). */
  sync?: SyncBadgeState;
  /** Linha abaixo do título no desktop ("Vistoria de entrada · Imobiliária Lar · iniciada em 19/10 às 09:12"). */
  subtitle?: string;
  /** A linha abaixo do título no celular, mais curta ("Vistoria de entrada"). */
  compactSubtitle?: string;
  /** Modo foco: no celular, sem a barra inferior, sem o avatar e sem o respiro do conteúdo. */
  focus?: boolean;
  /** Ações do registro, antes do SyncStatus (o "···" da tela de campo). */
  actions?: ReactNode;
}

export const ShellHeaderContext = createContext<(header: ShellHeader | null) => void>(() => {});

/** Troca o header do shell enquanto a tela está aberta. Não desenha nada no lugar. */
export function PageHeader({
  title,
  backHref,
  sync,
  subtitle,
  compactSubtitle,
  focus,
  actions,
}: ShellHeader) {
  const setHeader = useContext(ShellHeaderContext);

  useEffect(() => {
    setHeader({ title, backHref, sync, subtitle, compactSubtitle, focus, actions });
  }, [setHeader, title, backHref, sync, subtitle, compactSubtitle, focus, actions]);

  useEffect(() => () => setHeader(null), [setHeader]);

  return null;
}
