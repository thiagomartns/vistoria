"use client";

import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { CloudOff } from "lucide-react";

import { useDeviceSignIn } from "@/features/local-store/hooks/useDeviceAuth";
import { useLocalOutbox } from "@/features/local-store/hooks/useLocalOutbox";
import { useSession } from "@/shared/auth/useSession";
import { useLeaveWhenActive } from "@/shared/auth/useSessionGuard";
import { AuthLayout } from "@/shared/components/auth-layout";
import { SessionExpired } from "@/shared/components/session-expired";
import { SignInForm } from "@/shared/components/sign-in-form";
import { useSyncStatus } from "@/shared/sync/useSyncStatus";

export function SignInScreen() {
  const session = useSession();
  const sync = useSyncStatus();
  const { form, error, onSubmit, otherUser } = useDeviceSignIn();
  useLeaveWhenActive();
  // Com a sessão expirada, abre a outbox do dono para dizer quantas alterações esperam o login.
  useLocalOutbox();

  // Outro usuário com pendências do anterior: o aviso pede a decisão, e o formulário fica parado até ela (frame 2).
  // Com a sessão expirada, o aviso espera a primeira leitura da outbox, para não dizer "sem pendências" antes da hora.
  const notice = otherUser ? (
    <SessionExpired otherUser={otherUser} />
  ) : session.status === "expired" ? (
    sync.pending === null ? null : (
      <SessionExpired pending={sync.pending} />
    )
  ) : sync.offline ? (
    <Alert variant="warning" role="status">
      <CloudOff aria-hidden="true" />
      <AlertDescription>Conexão necessária para o primeiro acesso.</AlertDescription>
    </Alert>
  ) : null;

  return (
    <AuthLayout>
      <SignInForm
        form={form}
        onSubmit={onSubmit}
        error={error}
        notice={notice}
        disabled={otherUser !== null}
      />
    </AuthLayout>
  );
}
