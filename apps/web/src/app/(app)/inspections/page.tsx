import type { Metadata } from "next";
import { Suspense } from "react";

import { InspectionsScreen } from "./inspections-screen";

export const metadata: Metadata = { title: "Vistorias" };

// A busca e os filtros vêm do `?q=&cliente=…` (#175), lidos com `useSearchParams` dentro de Suspense (static export).
export default function InspectionsPage() {
  return (
    <Suspense fallback={null}>
      <InspectionsScreen />
    </Suspense>
  );
}
