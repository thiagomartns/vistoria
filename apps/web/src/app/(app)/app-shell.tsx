"use client";

import { Button } from "@sanjou/ui/button";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { useLocalOutbox } from "@/features/local-store/hooks/useLocalOutbox";
import { useSession } from "@/shared/auth/useSession";
import { useSessionGuard } from "@/shared/auth/useSessionGuard";
import { BottomNav, Sidebar } from "@/shared/components/nav";
import { OfflineBanner } from "@/shared/components/offline-banner";
import { OutboxPanel } from "@/shared/components/outbox-panel";
import { SyncBadge } from "@/shared/components/sync-badge";
import { SyncStatus } from "@/shared/components/sync-status";
import { UserMenu } from "@/shared/components/user-menu";
import { useSyncStatus } from "@/shared/sync/useSyncStatus";

import { NAV_ITEMS, navItemFor } from "./nav-items";
import { type ShellHeader, ShellHeaderContext } from "./shell-header";

// Shell do app (Figma "Shell (#7)", 14:1006): sidebar no desktop, barra inferior no celular, SyncStatus no header
// e OfflineBanner no topo do conteúdo. Uma tela de registro troca o título do header pelo <PageHeader />. Sem sessão vai para /login; com a sessão expirada, fica offline com os dados
// locais e vai para /login quando a rede volta. O bloqueio da janela offline de 72 h é do M4.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const sync = useSyncStatus();
  const [panelOpen, setPanelOpen] = useState(false);
  const [header, setHeader] = useState<ShellHeader | null>(null);
  useSessionGuard(sync.offline);
  useLocalOutbox();

  const current = navItemFor(pathname);
  const user = (layout: "sidebar" | "avatar") => (
    <UserMenu
      user={session.user}
      layout={layout}
      onSignIn={() => router.push("/login")}
      onSignOut={() => {
        session.signOut();
        router.push("/login");
      }}
    />
  );
  const status = (size: "completo" | "compacto") => (
    <SyncStatus
      state={sync.status.state}
      label={size === "completo" ? sync.status.label : sync.status.compactLabel}
      detail={sync.status.detail}
      size={size}
      onClick={() => setPanelOpen(true)}
    />
  );

  return (
    <div className="flex h-dvh bg-background">
      {/* Desktop e celular por breakpoint (md): cada wrapper só decide se aparece. */}
      <div className="hidden md:flex">
        <Sidebar items={NAV_ITEMS} activeHref={current?.href} footer={user("sidebar")} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 md:h-16 md:px-6 md:py-0">
          {header?.backHref ? (
            <Button asChild variant="ghost" size="icon">
              <Link href={header.backHref} aria-label="Voltar">
                <ChevronLeft aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate text-lg font-semibold text-foreground">
              {header?.title ?? current?.label}
            </h1>
            {header?.sync ? (
              <span className="hidden md:flex">
                <SyncBadge state={header.sync} />
              </span>
            ) : null}
          </div>
          <div className="hidden md:flex">{status("completo")}</div>
          <div className="flex items-center gap-2 md:hidden">
            {status("compacto")}
            {user("avatar")}
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:gap-4 md:p-6">
          {sync.offline ? <OfflineBanner type="aviso" /> : null}
          <ShellHeaderContext value={setHeader}>{children}</ShellHeaderContext>
        </main>
        <div className="md:hidden">
          <BottomNav items={NAV_ITEMS} activeHref={current?.href} />
        </div>
      </div>
      <OutboxPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        description={sync.panel.description}
        actionNeeded={sync.panel.actionNeeded}
        failing={sync.panel.failing}
        waiting={sync.panel.waiting}
        onRetryNow={sync.retryNow}
      />
    </div>
  );
}
