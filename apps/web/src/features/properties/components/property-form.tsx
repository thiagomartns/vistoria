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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";
import { Textarea } from "@sanjou/ui/textarea";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, FormEventHandler, ReactNode } from "react";
import type { Control, UseFormReturn } from "react-hook-form";

// O formulário de /properties/edit (Figma 71:3087 e 71:3337). No desktop, 720 px em linhas: Cliente e Tipo, CEP e
// Rua, Número e Complemento, Bairro, Cidade e UF; Observações e os botões lado a lado. No celular, um campo por linha,
// menos Número com Complemento e Cidade com UF; botões lg em largura total. O `form` vem do hook da página.

export type PropertyFormFields = {
  clientId: string;
  type: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  notes: string;
};

export interface Option {
  value: string;
  label: string;
}

type PropertyFormProps<TOutput> = {
  form: UseFormReturn<PropertyFormFields, unknown, TOutput>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  clientOptions: Option[];
  typeOptions: Option[];
  /** Para cadastrar um cliente quando o aparelho não tem nenhum. */
  newClientHref: string;
  /** Erro do formulário inteiro (recusa do servidor sem campo); o de campo vai no próprio campo. */
  error: string | null;
  cancelHref: string;
};

type TextName = Exclude<keyof PropertyFormFields, "clientId" | "type" | "notes">;

export function PropertyForm<TOutput>({
  form,
  onSubmit,
  clientOptions,
  typeOptions,
  newClientHref,
  error,
  cancelHref,
}: PropertyFormProps<TOutput>) {
  // O FormField do Sanjou não tem o tipo dos valores transformados (o schema troca "" por null ao salvar); para
  // desenhar os campos, só os valores de entrada importam.
  const control = form.control as unknown as Control<PropertyFormFields>;

  const text = (
    name: TextName,
    label: string,
    className: string,
    input: ComponentProps<typeof Input> = {},
  ) => (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input autoComplete="off" {...input} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const select = (
    name: "clientId" | "type",
    label: string,
    placeholder: string,
    options: Option[],
    className: string,
    description?: ReactNode,
  ) => (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <Select name={field.name} value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-5 md:max-w-[720px]">
        {error ? (
          <Alert variant="danger">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-3">
          {select(
            "clientId",
            "Cliente",
            "Selecione o cliente",
            clientOptions,
            "md:min-w-0 md:flex-1",
            clientOptions.length === 0 ? (
              <Link href={newClientHref} className="font-medium text-foreground underline">
                Cadastre um cliente antes.
              </Link>
            ) : undefined,
          )}
          {select("type", "Tipo", "Selecione o tipo", typeOptions, "md:w-[220px] md:shrink-0")}
        </div>
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-3">
          {text("zipCode", "CEP", "md:w-[160px] md:shrink-0", {
            inputMode: "numeric",
            maxLength: 9,
          })}
          {text("street", "Rua", "md:min-w-0 md:flex-1")}
        </div>
        <div className="flex items-start gap-3">
          {text("number", "Número", "w-[110px] shrink-0 md:w-[120px]")}
          {text("complement", "Complemento", "min-w-0 flex-1")}
        </div>
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-3">
          {text("district", "Bairro", "md:min-w-0 md:flex-1")}
          <div className="flex items-start gap-3 md:contents">
            {text("city", "Cidade", "min-w-0 flex-1")}
            {text("state", "UF", "w-[72px] shrink-0 md:w-[80px]", {
              autoCapitalize: "characters",
              maxLength: 2,
              spellCheck: false,
            })}
          </div>
        </div>
        <FormField
          control={control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Observações</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col gap-2 md:flex-row">
          <Button type="submit" size="lg" className="w-full md:h-8 md:w-auto md:px-3">
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
