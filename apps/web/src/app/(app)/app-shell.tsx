"use client";

import { Button } from "@sanjou/ui/button";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { useLocalOutbox } from "@/features/local-store/hooks/useLocalOutbox";
import { useSignOut } from "@/features/local-store/hooks/useSignOut";
import { useOfflineWindow } from "@/shared/auth/useOfflineWindow";
import { useSession } from "@/shared/auth/useSession";
import { useSessionGuard } from "@/shared/auth/useSessionGuard";
import { BottomNav, Sidebar } from "@/shared/components/nav";
import { OfflineBanner } from "@/shared/components/offline-banner";
import { OutboxPanel } from "@/shared/components/outbox-panel";
import { SignOutDialog } from "@/shared/components/sign-out-dialog";
import { SyncBadge } from "@/shared/components/sync-badge";
import { SyncStatus } from "@/shared/components/sync-status";
import { UserMenu } from "@/shared/components/user-menu";
import { useSyncStatus } from "@/shared/sync/useSyncStatus";

import { NAV_ITEMS, navItemFor } from "./nav-items";
import { type ShellHeader, ShellHeaderContext } from "./shell-header";

// Shell do app (Figma "Shell (#7)", 14:1006): sidebar no desktop, barra inferior no celular, SyncStatus no header
// e OfflineBanner no topo do conteúdo. Uma tela de registro troca o título do header pelo <PageHeader />; no modo foco
// (tela de campo), o celular fica sem a barra inferior e sem o avatar. Sem sessão vai para /login; com a sessão expirada, fica offline com os dados
// locais e vai para /login quando a rede volta. Vencida a janela offline de 72 h, o conteúdo vira o bloqueio
// "Reconecte para continuar", sem apagar nada, até um refresh aceito (frame 8 da #128). "Sair" passa pelo useSignOut:
// sem pendências limpa direto; com pendências, o SignOutDialog pede confirmação (frames 4 e 5).
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const conflicts = useLocalOutbox();
  const sync = useSyncStatus(conflicts);
  const [panelOpen, setPanelOpen] = useState(false);
  const [header, setHeader] = useState<ShellHeader | null>(null);
  const offlineWindow = useOfflineWindow();
  const signOut = useSignOut();
  useSessionGuard(sync.offline);

  const current = navItemFor(pathname);
  const user = (layout: "sidebar" | "avatar") => (
    <UserMenu
      user={session.user}
      layout={layout}
      onSignIn={() => router.push("/login")}
      onSignOut={() => void signOut.request()}
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
            <div className="flex min-w-0 flex-col">
              <h1
                className={`min-w-0 truncate font-semibold text-foreground ${header?.subtitle ? "text-sm md:text-lg" : "text-lg"}`}
              >
                {header?.title ?? current?.label}
              </h1>
              {header?.subtitle ? (
                <p className="min-w-0 truncate text-xs text-muted-foreground md:text-sm">
                  <span className="md:hidden">{header.compactSubtitle ?? header.subtitle}</span>
                  <span className="hidden md:inline">{header.subtitle}</span>
                </p>
              ) : null}
            </div>
            {header?.sync ? (
              <span className="hidden md:flex">
                <SyncBadge state={header.sync} />
              </span>
            ) : null}
          </div>
          {header?.actions ? <div className="flex shrink-0">{header.actions}</div> : null}
          <div className="hidden md:flex">{status("completo")}</div>
          <div className="flex items-center gap-2 md:hidden">
            {status("compacto")}
            {header?.focus ? null : user("avatar")}
          </div>
        </header>
        <main
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto md:gap-4 md:p-6 ${header?.focus ? "" : "gap-3 p-4"}`}
        >
          {offlineWindow.expired ? (
            <OfflineBanner
              type="bloqueio"
              pending={sync.pending ?? 0}
              onRetry={() => void session.renew()}
            />
          ) : (
            <>
              {sync.offline ? (
                <div className={header?.focus ? "px-4 pt-4 md:p-0" : "contents"}>
                  <OfflineBanner type="aviso" />
                </div>
              ) : null}
              <ShellHeaderContext value={setHeader}>{children}</ShellHeaderContext>
            </>
          )}
        </main>
        {header?.focus ? null : (
          <div className="md:hidden">
            <BottomNav items={NAV_ITEMS} activeHref={current?.href} />
          </div>
        )}
      </div>
      <SignOutDialog
        open={signOut.pending !== null}
        onOpenChange={(open) => {
          if (!open) signOut.cancel();
        }}
        pending={signOut.pending ?? 0}
        offline={sync.offline}
        busy={signOut.busy}
        onConfirm={signOut.confirm}
      />
      <OutboxPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        description={sync.panel.description}
        actionNeeded={sync.panel.actionNeeded}
        failing={sync.panel.failing}
        waiting={sync.panel.waiting}
        onRetryNow={sync.retryNow}
        onResolve={(item) => {
          setPanelOpen(false);
          if (item.href) router.push(item.href);
        }}
      />
    </div>
  );
}
