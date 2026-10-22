import type { Metadata } from "next";
import { Suspense } from "react";

import { ClientEditScreen } from "./client-edit-screen";

export const metadata: Metadata = { title: "Cliente" };

// `?id=` em vez de segmento dinâmico (static export); sem `id`, cria.
export default function ClientEditPage() {
  return (
    <Suspense fallback={null}>
      <ClientEditScreen />
    </Suspense>
  );
}
