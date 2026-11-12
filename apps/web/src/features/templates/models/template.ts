import type { UpsertTemplateDto } from "@/shared/api/generated";

/** Um item do roteiro: só o molde, sem condição (vision.md, "Client, Property e Template"). */
export interface TemplateItem {
  id: string;
  name: string;
  position: number;
}

/** Um ambiente do roteiro, com os itens na ordem da `position`. */
export interface TemplateRoom {
  id: string;
  name: string;
  position: number;
  items: TemplateItem[];
}

/**
 * Template no banco local: o corpo do `PUT` com o `id` gerado no aparelho e a `version` que o servidor confirmou
 * (`null` enquanto o roteiro só existe no aparelho). No `UpsertTemplateDto`, os ids e a posição de ambientes e itens
 * são nuláveis porque o servidor os completa; aqui eles sempre existem.
 */
export type TemplateRecord = { id: string; version: string | null } & Omit<
  UpsertTemplateDto,
  "rooms"
> & {
    rooms: TemplateRoom[];
  };

/** A entidade dos rascunhos de template (`DraftRecord.entity`). */
export const TEMPLATE_ENTITY = "template";
