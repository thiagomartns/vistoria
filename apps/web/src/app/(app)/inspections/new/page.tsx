import type { Metadata } from "next";

import { NewInspectionScreen } from "./new-inspection-screen";

export const metadata: Metadata = { title: "Nova vistoria" };

export default function NewInspectionPage() {
  return <NewInspectionScreen />;
}
