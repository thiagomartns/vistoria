import type { Metadata } from "next";
import type { ReactNode } from "react";

import { APP_NAME } from "@/shared/app";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Vistoria de imóveis para locação, local-first.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
