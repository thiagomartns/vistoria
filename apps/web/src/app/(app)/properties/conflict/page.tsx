import type { Metadata } from "next";
import { Suspense } from "react";

import { PropertyConflictScreen } from "./conflict-screen";

export const metadata: Metadata = { title: "Conflito" };

// `?id=` em vez de segmento dinâmico (static export).
export default function PropertyConflictPage() {
  return (
    <Suspense fallback={null}>
      <PropertyConflictScreen />
    </Suspense>
  );
}
