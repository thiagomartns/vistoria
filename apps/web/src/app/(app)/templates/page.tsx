import type { Metadata } from "next";

import { TemplatesScreen } from "./templates-screen";

export const metadata: Metadata = { title: "Roteiros" };

export default function TemplatesPage() {
  return <TemplatesScreen />;
}
