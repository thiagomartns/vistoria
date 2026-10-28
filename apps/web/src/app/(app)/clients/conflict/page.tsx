import type { Metadata } from "next";
import { Suspense } from "react";

import { ClientConflictScreen } from "./conflict-screen";

export const metadata: Metadata = { title: "Conflito" };

// `?id=` em vez de segmento dinâmico (static export).
export default function ClientConflictPage() {
  return (
    <Suspense fallback={null}>
      <ClientConflictScreen />
    </Suspense>
  );
}
