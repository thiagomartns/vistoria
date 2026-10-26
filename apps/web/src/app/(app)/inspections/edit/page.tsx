import type { Metadata } from "next";
import { Suspense } from "react";

import { InspectionEditScreen } from "./inspection-edit-screen";

export const metadata: Metadata = { title: "Vistoria" };

// `?id=` em vez de segmento dinâmico (static export).
export default function InspectionEditPage() {
  return (
    <Suspense fallback={null}>
      <InspectionEditScreen />
    </Suspense>
  );
}
