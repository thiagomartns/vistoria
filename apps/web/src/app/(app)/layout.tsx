import type { ReactNode } from "react";

import { AppShell } from "./app-shell";

export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
