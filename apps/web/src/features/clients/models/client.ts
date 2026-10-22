import type { UpsertClientDto } from "@/shared/api/generated";

/**
 * Client no banco local: o corpo do `PUT` com o `id` gerado no aparelho e a `version` que o servidor confirmou
 * (`null` enquanto o registro só existe no aparelho).
 */
export type ClientRecord = { id: string; version: string | null } & Required<UpsertClientDto>;

/** A entidade dos rascunhos de client (`DraftRecord.entity`). */
export const CLIENT_ENTITY = "client";
