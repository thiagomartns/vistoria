import { defineConfig } from "@hey-api/openapi-ts";

// Lê o openapi.json commitado (sem API rodando) e grava o contrato em apps/web/src/shared/api/generated/.
// O gerador usa a API JS do compilador TypeScript, que o TypeScript 7 do web não expõe; por isso ele mora
// neste pacote, com o TypeScript 6 fixado. O código gerado é checado pelo tsc do web normalmente.
export default defineConfig({
  input: "../../apps/api/openapi.json",
  output: { path: "../../apps/web/src/shared/api/generated" },
  // A API serializa DateTimeOffset com o fuso ("+00:00"), não com "Z": sem `offset`, o Zod recusaria o `deletedAt` do
  // 410 e o ProblemDetails inteiro viraria resposta ilegível (tentar de novo, para sempre).
  plugins: [
    "@hey-api/typescript",
    "@hey-api/client-fetch",
    "@hey-api/sdk",
    { name: "zod", dates: { offset: true } },
  ],
});
