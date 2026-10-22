"use client";

import { useLeaveWhenActive } from "@/shared/auth/useSessionGuard";
import { useSignUp } from "@/shared/auth/useSignUp";
import { AuthLayout } from "@/shared/components/auth-layout";
import { SignUpForm } from "@/shared/components/sign-up-form";

export function SignUpScreen() {
  const { form, error, onSubmit } = useSignUp();
  useLeaveWhenActive();

  return (
    <AuthLayout>
      <SignUpForm form={form} onSubmit={onSubmit} error={error} />
    </AuthLayout>
  );
}
