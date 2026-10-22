import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type DefaultValues, type FieldValues, type Path, useForm } from "react-hook-form";
import type { z } from "zod";

import type { ApiFailure } from "../api/problems";
import { readAuthFailure } from "./auth-failure";

/** Para onde o login e o cadastro levam sem `?next=`: a lista de vistorias, a entrada do app. */
export const AFTER_SIGN_IN = "/inspections";

/**
 * Para onde ir depois de entrar: o `?next=` que o guard do shell deixou (a tela onde a sessão expirou), se for um
 * caminho deste app, ou a lista de vistorias. `//host` e `/\host` são outra origem para o navegador.
 */
export function afterSignIn(search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next && /^\/(?![/\\])/.test(next) ? next : AFTER_SIGN_IN;
}

interface AuthFormOptions<T extends FieldValues> {
  schema: z.ZodType<T, T>;
  errors: { error: z.core.$ZodErrorMap };
  defaultValues: DefaultValues<T>;
  submit: (values: T) => Promise<ApiFailure | null>;
  /** Mensagem para a falha sem reação própria. */
  fallback: string;
}

/** O formulário de /login ou /signup: validação pelo Zod da UI, envio, erros do contrato e ida para o app. */
export function useAuthForm<T extends FieldValues>({
  schema,
  errors,
  defaultValues,
  submit,
  fallback,
}: AuthFormOptions<T>) {
  const router = useRouter();
  const form = useForm<T>({ resolver: zodResolver(schema, errors), defaultValues });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const failure = await submit(values);
    if (!failure) {
      router.replace(afterSignIn(window.location.search));
      return;
    }
    const view = readAuthFailure(failure, Object.keys(defaultValues), fallback);
    for (const [name, message] of Object.entries(view.fields)) {
      form.setError(name as Path<T>, { type: "server", message });
    }
    setError(view.form);
  });

  return { form, error, onSubmit };
}
