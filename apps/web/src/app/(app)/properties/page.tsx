import type { Metadata } from "next";

import { PropertiesScreen } from "./properties-screen";

export const metadata: Metadata = { title: "Imóveis" };

export default function PropertiesPage() {
  return <PropertiesScreen />;
}
