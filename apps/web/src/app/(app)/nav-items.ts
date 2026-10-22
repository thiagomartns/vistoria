import { Building2, ClipboardList, House, ListChecks } from "lucide-react";

import type { NavEntry } from "@/shared/components/nav";

// Destinos da navegação do shell (vision.md, "Telas e fluxo principal").
export const NAV_ITEMS: NavEntry[] = [
  { href: "/inspections", label: "Vistorias", icon: ClipboardList },
  { href: "/clients", label: "Clientes", icon: Building2 },
  { href: "/properties", label: "Imóveis", icon: House },
  { href: "/templates", label: "Roteiros", icon: ListChecks },
];

/** O item da rota: `/clients/edit` é de "Clientes". */
export function navItemFor(pathname: string): NavEntry | undefined {
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
