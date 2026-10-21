import type { Metadata } from "next";

import { OutboxProof } from "./outbox-proof";

export const metadata: Metadata = {
  title: "Prova da outbox",
};

// Página de prova do spike 1a (#59, ADR 0030): cria e edita clients offline pela outbox do TanStack DB.
// Usada pelo roteiro `pnpm spike:outbox`; sai quando a tela de clients do Figma chegar (M5).
export default function OutboxProofPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Prova da outbox</h1>
        <p className="text-muted-foreground">
          Clients no banco local, enviados como <code className="font-mono">PUT</code> pela outbox.
        </p>
      </header>
      <OutboxProof />
    </main>
  );
}
