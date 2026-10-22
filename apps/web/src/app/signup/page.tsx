import type { Metadata } from "next";

import { SignUpScreen } from "./sign-up-screen";

export const metadata: Metadata = { title: "Criar conta" };

// /signup (Figma 66:2164): cria a conta e entra direto, sem verificação de e-mail (ADR 0019).
export default function SignUpPage() {
  return <SignUpScreen />;
}
