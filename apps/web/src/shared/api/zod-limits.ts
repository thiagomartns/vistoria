import { z } from "zod";

/** O `.max()` de uma lista do Zod gerado, pelo JSON Schema dela: os limites do contrato saem do OpenAPI, não de um literal. */
export function maxItemsOf(schema: z.ZodArray): number {
  const { maxItems } = z.toJSONSchema(schema);
  if (maxItems === undefined) throw new Error("Lista do contrato sem limite.");
  return maxItems;
}
