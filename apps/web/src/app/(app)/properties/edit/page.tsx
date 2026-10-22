import type { Metadata } from "next";
import { Suspense } from "react";

import { PropertyEditScreen } from "./property-edit-screen";

export const metadata: Metadata = { title: "Imóvel" };

// `?id=` em vez de segmento dinâmico (static export); sem `id`, cria.
export default function PropertyEditPage() {
  return (
    <Suspense fallback={null}>
      <PropertyEditScreen />
    </Suspense>
  );
}
