import type { PropertyType, UpsertPropertyDto } from "@/shared/api/generated";

/**
 * Property no banco local: o corpo do `PUT` com o `id` gerado no aparelho e a `version` que o servidor confirmou
 * (`null` enquanto o registro só existe no aparelho). `clientId` e `type` são nuláveis no DTO só para o `[Required]`
 * do .NET pegar o campo ausente; aqui eles sempre existem.
 */
export type PropertyRecord = { id: string; version: string | null } & Omit<
  Required<UpsertPropertyDto>,
  "clientId" | "type"
> & { clientId: string; type: PropertyType };

export type { PropertyType };

/** A entidade dos rascunhos de property (`DraftRecord.entity`). */
export const PROPERTY_ENTITY = "property";
