import type { Metadata } from "next";
import { Suspense } from "react";

import { NewInspectionScreen } from "./new-inspection-screen";

export const metadata: Metadata = { title: "Nova vistoria" };

// `?propertyId=` (vindo do histórico do imóvel) já escolhe o imóvel.
export default function NewInspectionPage() {
  return (
    <Suspense fallback={null}>
      <NewInspectionScreen />
    </Suspense>
  );
}
