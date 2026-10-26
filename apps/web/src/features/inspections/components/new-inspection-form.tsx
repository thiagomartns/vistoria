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
import { Label } from "@sanjou/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { FormEventHandler } from "react";
import type { UseFormReturn } from "react-hook-form";

import { ToggleGroup, ToggleGroupItem } from "@/shared/components/toggle-group";

// O formulário de /inspections/new (wireframe 68:1644): Imóvel, Tipo e Roteiro, com "Começar vistoria" e "Cancelar".
// No desktop, 560 px; no celular, largura cheia e botões lg. A saída aparece desabilitada (chega no M5, a partir de
// uma entrada concluída) e o roteiro é o fixo, a única opção até os roteiros editáveis. Sem imóvel no aparelho, um
// aviso leva ao cadastro. O `form` vem do hook da página.

export interface Option {
  value: string;
  label: string;
}

type NewInspectionFormProps = {
  form: UseFormReturn<{ propertyId: string }>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  propertyOptions: Option[];
  templateLabel: string;
  newPropertyHref: string;
  propertiesHref: string;
  cancelHref: string;
};

const TEMPLATE = "fixo";

export function NewInspectionForm({
  form,
  onSubmit,
  propertyOptions,
  templateLabel,
  newPropertyHref,
  propertiesHref,
  cancelHref,
}: NewInspectionFormProps) {
  const noProperties = propertyOptions.length === 0;
  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-6 md:max-w-[560px]">
        {noProperties ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription className="flex flex-col items-start gap-3">
              Nenhum imóvel neste aparelho. Cadastre um imóvel antes de começar.
              <Button asChild variant="outline">
                <Link href={newPropertyHref}>Cadastrar imóvel</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <FormField
          control={form.control}
          name="propertyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Imóvel</FormLabel>
              <Select
                name={field.name}
                value={field.value}
                onValueChange={field.onChange}
                disabled={noProperties}
              >
                <FormControl>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                    <SelectValue placeholder="Escolha o imóvel" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {propertyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Imóvel novo? Cadastre em{" "}
                <Link href={propertiesHref} className="font-medium text-foreground underline">
                  Imóveis
                </Link>
                .
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col gap-1.5">
          <Label id="tipo-label">Tipo</Label>
          <ToggleGroup
            aria-labelledby="tipo-label"
            aria-describedby="tipo-descricao"
            value="moveIn"
            values={["moveIn", "moveOut"]}
            onValueChange={() => {}}
            size="auto"
          >
            <ToggleGroupItem value="moveIn">Entrada</ToggleGroupItem>
            <ToggleGroupItem value="moveOut" disabled>
              Saída
            </ToggleGroupItem>
          </ToggleGroup>
          <p id="tipo-descricao" className="text-sm text-muted-foreground">
            A saída chega numa próxima versão.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roteiro">Roteiro</Label>
          <Select value={TEMPLATE} disabled={noProperties}>
            <SelectTrigger id="roteiro" className="w-full" aria-describedby="roteiro-descricao">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TEMPLATE}>{templateLabel}</SelectItem>
            </SelectContent>
          </Select>
          <p id="roteiro-descricao" className="text-sm text-muted-foreground">
            Ambientes e itens são copiados para a vistoria; depois de criada, ela não depende mais
            do roteiro.
          </p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <Button
            type="submit"
            size="lg"
            className="w-full md:h-8 md:w-auto md:px-3"
            disabled={noProperties}
          >
            Começar vistoria
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full md:h-8 md:w-auto md:px-3">
            <Link href={cancelHref}>Cancelar</Link>
          </Button>
        </div>
      </form>
    </Form>
  );
}
