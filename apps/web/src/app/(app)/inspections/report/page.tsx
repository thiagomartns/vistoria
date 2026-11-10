import type { Metadata } from "next";
import { Suspense } from "react";

import { ReportScreen } from "./report-screen";

export const metadata: Metadata = { title: "Laudo" };

// `?id=` em vez de segmento dinâmico (static export).
export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportScreen />
    </Suspense>
  );
}
