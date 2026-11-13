import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { FormEventHandler } from "react";
import type { UseFormReturn } from "react-hook-form";

import { ToggleGroup, ToggleGroupItem } from "@/shared/components/toggle-group";

// O formulário de /inspections/new (wireframes 68:1644 e 68:1878, e a seção "Nova vistoria · roteiro (#174)"): Imóvel
// e Tipo; na entrada, o Roteiro, entre os do aparelho, ou o roteiro padrão num aparelho sem nenhum, com o link para
// Roteiros; na saída, a Vistoria de entrada de onde ela parte, ou, sem entrada concluída
// no imóvel, o aviso e "Começar vistoria" desabilitado (68:1759). "Começar vistoria" e "Cancelar". No desktop, 560 px;
// no celular, largura cheia e botões lg. Sem imóvel no aparelho, um aviso leva ao cadastro. O `form` vem do hook da
// página.

export interface Option {
  value: string;
  label: string;
}

type NewInspectionFormProps = {
  form: UseFormReturn<{
    propertyId: string;
    kind: "moveIn" | "moveOut";
    moveInId: string;
    templateId: string;
  }>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  propertyOptions: Option[];
  /** Os roteiros do aparelho, ou só o roteiro padrão. */
  templateOptions: Option[];
  /** O roteiro de onde a entrada parte: o escolhido, ou o primeiro. */
  templateId: string;
  /** Sem roteiro no aparelho: a opção é o roteiro padrão. */
  defaultTemplate: boolean;
  templatesHref: string;
  /** O tipo escolhido é saída. */
  moveOut: boolean;
  /** As entradas concluídas do imóvel escolhido. */
  moveInOptions: Option[];
  /** A entrada de onde a saída parte: a escolhida, ou a mais recente sem saída. */
  moveInId: string;
  /** A escolhida já tem saída no aparelho (#184): o rótulo corta no celular, a descrição diz. */
  chosenHasMoveOut: boolean;
  /** Saída num imóvel sem entrada concluída. */
  noMoveIn: boolean;
  /** A saída ainda não pode começar (sem entrada, ou lendo a escolhida). */
  waitingMoveIn: boolean;
  newPropertyHref: string;
  propertiesHref: string;
  cancelHref: string;
};

export function NewInspectionForm({
  form,
  onSubmit,
  propertyOptions,
  templateOptions,
  templateId,
  defaultTemplate,
  templatesHref,
  moveOut,
  moveInOptions,
  moveInId,
  chosenHasMoveOut,
  noMoveIn,
  waitingMoveIn,
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
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo</FormLabel>
              <FormControl>
                <ToggleGroup
                  aria-label="Tipo"
                  value={field.value}
                  values={["moveIn", "moveOut"]}
                  onValueChange={(value) => field.onChange(value)}
                  size="auto"
                >
                  <ToggleGroupItem value="moveIn">Entrada</ToggleGroupItem>
                  <ToggleGroupItem value="moveOut">Saída</ToggleGroupItem>
                </ToggleGroup>
              </FormControl>
            </FormItem>
          )}
        />
        {!moveOut ? (
          <FormField
            control={form.control}
            name="templateId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Roteiro</FormLabel>
                <Select
                  name={field.name}
                  value={templateId}
                  onValueChange={field.onChange}
                  disabled={noProperties}
                >
                  <FormControl>
                    <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {templateOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {defaultTemplate ? (
                    <>
                      Nenhum roteiro neste aparelho: a entrada parte do roteiro padrão. Crie os seus
                      em{" "}
                      <Link href={templatesHref} className="font-medium text-foreground underline">
                        Roteiros
                      </Link>
                      .
                    </>
                  ) : (
                    "Ambientes e itens são copiados para a vistoria; depois de criada, ela não depende mais do roteiro."
                  )}
                </FormDescription>
              </FormItem>
            )}
          />
        ) : noMoveIn ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Este imóvel não tem vistoria de entrada concluída</AlertTitle>
            <AlertDescription>
              A saída parte de uma entrada concluída do mesmo imóvel. Conclua a entrada ou crie uma
              vistoria de entrada.
            </AlertDescription>
          </Alert>
        ) : (
          <FormField
            control={form.control}
            name="moveInId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vistoria de entrada</FormLabel>
                <Select
                  name={field.name}
                  value={moveInId}
                  onValueChange={field.onChange}
                  disabled={moveInOptions.length === 0}
                >
                  <FormControl>
                    <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                      <SelectValue placeholder="Escolha o imóvel primeiro" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {moveInOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {chosenHasMoveOut
                    ? "Esta entrada já tem uma saída neste aparelho; começar outra pede confirmação."
                    : "Ambientes e itens são copiados com o estado da entrada, que aparece ao lado de cada item na tela de campo."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <div className="flex flex-col gap-2 md:flex-row">
          <Button
            type="submit"
            size="lg"
            className="w-full md:h-8 md:w-auto md:px-3"
            disabled={noProperties || (moveOut && waitingMoveIn)}
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
