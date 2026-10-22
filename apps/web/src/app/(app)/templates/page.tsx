import type { Metadata } from "next";

import { ComingSoon } from "../coming-soon";

export const metadata: Metadata = { title: "Roteiros" };

export default function TemplatesPage() {
  return <ComingSoon />;
}
