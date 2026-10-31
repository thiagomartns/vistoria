import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Form } from "@sanjou/ui/form";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import type { FormEventHandler, ReactNode } from "react";
import { type FieldValues, type UseFormReturn, useFormState } from "react-hook-form";

import { AvisLockup } from "./avis-lockup";

// Base do "Auth form" do Figma (Sign in 66:907, Create account 66:1962): lockup vertical com legenda, título,
// aviso opcional (SessionExpired, offline), erro do formulário, campos, botão de largura total e o link para a
// outra tela. Os campos vêm de quem usa; o `form` vem do hook da página.

export type AuthFormProps<T extends FieldValues> = {
  form: UseFormReturn<T>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /** Erro do formulário inteiro (credencial inválida, rede); o de campo vai no próprio campo. */
  error: string | null;
  /** Aviso acima do título: SessionExpired, ou "Conexão necessária" sem rede. */
  notice?: ReactNode;
  /** Campos e botão desabilitados enquanto o aviso pede uma decisão (outro usuário, frame 2 da #128). */
  disabled?: boolean;
};

type AuthFormLayoutProps<T extends FieldValues> = AuthFormProps<T> & {
  title: string;
  description: string;
  submitLabel: string;
  submittingLabel: string;
  footer: { text: string; link: string; href: string };
  children: ReactNode;
};

export function AuthForm<T extends FieldValues>({
  form,
  onSubmit,
  error,
  notice,
  disabled = false,
  title,
  description,
  submitLabel,
  submittingLabel,
  footer,
  children,
}: AuthFormLayoutProps<T>) {
  const { isSubmitting } = useFormState({ control: form.control });

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <AvisLockup layout="vertical" caption />
      {notice}
      <header className="flex w-full flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.015em] text-foreground">{title}</h1>
        <p className="text-base text-muted-foreground">{description}</p>
      </header>
      <Form {...form}>
        <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-6">
          {error ? (
            <Alert variant="danger">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <fieldset disabled={disabled} className="contents">
            <div className="flex flex-col gap-4">{children}</div>
            <Button type="submit" className="w-full" disabled={isSubmitting || disabled}>
              {isSubmitting ? submittingLabel : submitLabel}
            </Button>
          </fieldset>
        </form>
      </Form>
      <p className="text-center text-sm text-muted-foreground">
        {footer.text}{" "}
        <Link href={footer.href} className="font-medium text-brand-text hover:underline">
          {footer.link}
        </Link>
      </p>
    </div>
  );
}
