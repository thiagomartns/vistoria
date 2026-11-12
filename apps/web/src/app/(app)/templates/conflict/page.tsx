import type { Metadata } from "next";
import { Suspense } from "react";

import { TemplateConflictScreen } from "./conflict-screen";

export const metadata: Metadata = { title: "Conflito" };

// `?id=` em vez de segmento dinâmico (static export).
export default function TemplateConflictPage() {
  return (
    <Suspense fallback={null}>
      <TemplateConflictScreen />
    </Suspense>
  );
}
