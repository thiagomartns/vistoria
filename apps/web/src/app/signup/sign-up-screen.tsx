"use client";

import { useDeviceSignUp } from "@/features/local-store/hooks/useDeviceAuth";
import { useLeaveWhenActive } from "@/shared/auth/useSessionGuard";
import { AuthLayout } from "@/shared/components/auth-layout";
import { SessionExpired } from "@/shared/components/session-expired";
import { SignUpForm } from "@/shared/components/sign-up-form";

export function SignUpScreen() {
  const { form, error, onSubmit, otherUser } = useDeviceSignUp();
  useLeaveWhenActive();

  // A conta nova é outro `user.id`: com pendências do dono anterior, o mesmo aviso do /login (ADR 0046).
  return (
    <AuthLayout>
      <SignUpForm
        form={form}
        onSubmit={onSubmit}
        error={error}
        notice={otherUser ? <SessionExpired otherUser={otherUser} /> : null}
        disabled={otherUser !== null}
      />
    </AuthLayout>
  );
}
