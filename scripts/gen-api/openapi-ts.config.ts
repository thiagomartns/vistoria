import { defineConfig } from "@hey-api/openapi-ts";

// Lê o openapi.json commitado (sem API rodando) e grava o contrato em apps/web/src/shared/api/generated/.
// O gerador usa a API JS do compilador TypeScript, que o TypeScript 7 do web não expõe; por isso ele mora
// neste pacote, com o TypeScript 6 fixado. O código gerado é checado pelo tsc do web normalmente.
export default defineConfig({
  input: "../../apps/api/openapi.json",
  output: { path: "../../apps/web/src/shared/api/generated" },
  plugins: ["@hey-api/typescript", "@hey-api/client-fetch", "@hey-api/sdk", "zod"],
});
