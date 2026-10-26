import type { Metadata } from "next";

import { InspectionsScreen } from "./inspections-screen";

export const metadata: Metadata = { title: "Vistorias" };

export default function InspectionsPage() {
  return <InspectionsScreen />;
}
