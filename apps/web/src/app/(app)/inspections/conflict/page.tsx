import type { Metadata } from "next";
import { Suspense } from "react";

import { ConflictScreen } from "./conflict-screen";

export const metadata: Metadata = { title: "Conflito" };

// `?id=` em vez de segmento dinâmico (static export).
export default function InspectionConflictPage() {
  return (
    <Suspense fallback={null}>
      <ConflictScreen />
    </Suspense>
  );
}
