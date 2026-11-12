import type { Metadata } from "next";
import { Suspense } from "react";

import { TemplateEditScreen } from "./template-edit-screen";

export const metadata: Metadata = { title: "Roteiro" };

// `?id=` em vez de segmento dinâmico (static export); sem `id`, cria.
export default function TemplateEditPage() {
  return (
    <Suspense fallback={null}>
      <TemplateEditScreen />
    </Suspense>
  );
}
