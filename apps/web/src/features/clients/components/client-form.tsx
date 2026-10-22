import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@sanjou/ui/form";
import { Input } from "@sanjou/ui/input";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import type { FormEventHandler } from "react";
import type { Control, UseFormReturn } from "react-hook-form";

// O formulário de /clients/edit (Figma 70:2719 e 70:2862): Nome, CPF ou CNPJ, E-mail e Telefone, Salvar e Cancelar.
// No desktop, 560 px e botões lado a lado; no celular, botões lg em largura total. O `form` vem do hook da página.

export type ClientFormFields = { name: string; document: string; email: string; phone: string };

type ClientFormProps<TOutput> = {
  form: UseFormReturn<ClientFormFields, unknown, TOutput>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /** Erro do formulário inteiro (recusa do servidor sem campo); o de campo vai no próprio campo. */
  error: string | null;
  cancelHref: string;
  disabled?: boolean;
};

type FieldSpec = {
  name: keyof ClientFormFields;
  label: string;
  description?: string;
  input: React.ComponentProps<typeof Input>;
};

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Nome", input: { autoComplete: "off" } },
  {
    name: "document",
    label: "CPF ou CNPJ",
    description: "Opcional. Validado ao salvar.",
    input: { autoComplete: "off", autoCapitalize: "characters", spellCheck: false },
  },
  { name: "email", label: "E-mail", input: { type: "email", autoComplete: "off" } },
  { name: "phone", label: "Telefone", input: { type: "tel", autoComplete: "off" } },
];

export function ClientForm<TOutput>({
  form,
  onSubmit,
  error,
  cancelHref,
  disabled,
}: ClientFormProps<TOutput>) {
  // O FormField do Sanjou não tem o tipo dos valores transformados (o schema troca "" por null ao salvar); para
  // desenhar os campos, só os valores de entrada importam.
  const control = form.control as unknown as Control<ClientFormFields>;
  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-5 md:max-w-[560px]">
        {error ? (
          <Alert variant="danger">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {FIELDS.map((spec) => (
          <FormField
            key={spec.name}
            control={control}
            name={spec.name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{spec.label}</FormLabel>
                <FormControl>
                  <Input {...spec.input} {...field} />
                </FormControl>
                {spec.description ? <FormDescription>{spec.description}</FormDescription> : null}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <div className="flex flex-col gap-2 md:flex-row">
          <Button type="submit" size="lg" className="w-full md:h-8 md:w-auto md:px-3" disabled={disabled}>
            Salvar
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full md:h-8 md:w-auto md:px-3">
            <Link href={cancelHref}>Cancelar</Link>
          </Button>
        </div>
      </form>
    </Form>
  );
}
