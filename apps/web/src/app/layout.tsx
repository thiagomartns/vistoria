import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { APP_TITLE } from "@/shared/app";

import { ServiceWorkerRegistration } from "./service-worker-registration";

import "./globals.css";

// Baixadas no build e servidas junto com o export: nada de fonte vem da rede em runtime.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: APP_TITLE,
  description: "Vistoria de imóveis para locação, local-first.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
