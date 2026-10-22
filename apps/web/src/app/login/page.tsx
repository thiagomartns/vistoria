import type { Metadata } from "next";

import { SignInScreen } from "./sign-in-screen";

export const metadata: Metadata = { title: "Entrar" };

// /login (Figma 66:2053): também é a tela de sessão expirada (ADR 0019).
export default function LoginPage() {
  return <SignInScreen />;
}
