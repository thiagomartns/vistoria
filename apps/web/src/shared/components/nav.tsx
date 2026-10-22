import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AvisLockup } from "./avis-lockup";

// Navegação do shell (Figma Nav/Item 11:812, Nav/Sidebar 11:813, Nav/Barra inferior 11:882). Candidato ao Sanjou.
// O ativo usa fundo `accent` e texto forte, nunca só cor.

export interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
}

type NavItemProps = NavEntry & {
  layout: "sidebar" | "barra";
  active: boolean;
};

export function NavItem({ href, label, icon: Icon, layout, active }: NavItemProps) {
  if (layout === "sidebar") {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${
          active ? "bg-accent text-foreground" : "text-muted-foreground"
        }`}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        className={`flex h-7 w-14 items-center justify-center rounded-full ${active ? "bg-accent text-brand-text" : "text-muted-foreground"}`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span
        className={`text-xs ${active ? "font-semibold text-brand-text" : "font-medium text-muted-foreground"}`}
      >
        {label}
      </span>
    </Link>
  );
}

type NavProps = {
  items: NavEntry[];
  /** `href` do item da rota atual. */
  activeHref: string | undefined;
};

/** Desktop: marca, os itens e o usuário no rodapé. */
export function Sidebar({ items, activeHref, footer }: NavProps & { footer: ReactNode }) {
  return (
    <aside className="flex h-dvh w-60 shrink-0 flex-col gap-4 border-r border-border bg-background px-3 pt-4 pb-3">
      <div className="flex px-3">
        <AvisLockup layout="horizontal" />
      </div>
      <nav aria-label="Principal" className="flex flex-col gap-1">
        {items.map((item) => (
          <NavItem key={item.href} {...item} layout="sidebar" active={item.href === activeHref} />
        ))}
      </nav>
      <div className="flex-1" />
      {footer}
    </aside>
  );
}

/** Celular: barra inferior ao alcance do polegar, com a área segura embaixo. */
export function BottomNav({ items, activeHref }: NavProps) {
  return (
    <nav
      aria-label="Principal"
      className="flex border-t border-border bg-background px-2 pt-1 pb-[max(20px,env(safe-area-inset-bottom))]"
    >
      {items.map((item) => (
        <NavItem key={item.href} {...item} layout="barra" active={item.href === activeHref} />
      ))}
    </nav>
  );
}
