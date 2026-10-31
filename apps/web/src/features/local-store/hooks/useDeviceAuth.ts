import { useState } from "react";

import type { Authentication } from "@/shared/auth/session";
import { authenticateNewAccount, authenticateWithPassword } from "@/shared/auth/session";
import {
  type SignInValues,
  type SignUpValues,
  signInErrors,
  signInSchema,
  signUpErrors,
  signUpSchema,
} from "@/shared/auth/session.schemas";
import { useAuthForm } from "@/shared/auth/useAuthForm";

import { type OtherUserDecision, enterOnDevice } from "../services/device-session";

/** O aviso de outro usuário enquanto a pessoa decide (SessionExpired, frame 2 da #128). */
export interface OtherUserPrompt {
  previousName: string;
  pending: number;
  /** A decisão está saindo. */
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * O envio de /login e /signup com o banco local do aparelho: a API confere, e `enterOnDevice` decide se entra direto
 * ou se pergunta (outro usuário com pendências do anterior, ADR 0046). Enquanto pergunta, o formulário fica parado.
 */
function useDeviceAuthDecision() {
  const [decision, setDecision] = useState<OtherUserDecision | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async (authenticate: () => Promise<Authentication>) => {
    const result = await authenticate();
    if (!result.ok) return result.failure;
    const pending = await enterOnDevice(result.auth);
    if (!pending) return null;
    setDecision(pending);
    return "hold" as const;
  };

  const prompt = (leave: () => void): OtherUserPrompt | null =>
    decision && {
      previousName: decision.previous.name,
      pending: decision.pending,
      busy,
      onCancel: () => {
        setBusy(true);
        void decision.cancel().finally(() => {
          setDecision(null);
          setBusy(false);
        });
      },
      onConfirm: () => {
        setBusy(true);
        void decision
          .confirm()
          .then(() => {
            setDecision(null);
            leave();
          })
          .finally(() => setBusy(false));
      },
    };

  return { enter, prompt };
}

/** O formulário de /login. */
export function useDeviceSignIn() {
  const { enter, prompt } = useDeviceAuthDecision();
  const auth = useAuthForm<SignInValues>({
    schema: signInSchema,
    errors: signInErrors,
    defaultValues: { email: "", password: "" },
    submit: ({ email, password }) => enter(() => authenticateWithPassword(email, password)),
    fallback: "Não foi possível entrar agora. Tente de novo em instantes.",
  });
  return { ...auth, otherUser: prompt(auth.leave) };
}

/** O formulário de /signup: a conta nova é sempre outro `user.id`, com a mesma regra do login. */
export function useDeviceSignUp() {
  const { enter, prompt } = useDeviceAuthDecision();
  const auth = useAuthForm<SignUpValues>({
    schema: signUpSchema,
    errors: signUpErrors,
    defaultValues: { name: "", email: "", password: "" },
    submit: ({ name, email, password }) =>
      enter(() => authenticateNewAccount(name, email, password)),
    fallback: "Não foi possível criar a conta agora. Tente de novo em instantes.",
  });
  return { ...auth, otherUser: prompt(auth.leave) };
}
