import type { UpsertClientDto } from "@/shared/api/generated";

/** Client no banco local: o corpo do `PUT` com o `id` gerado no aparelho. */
export type ClientRecord = { id: string } & Required<UpsertClientDto>;
