import type { MetadataRoute } from "next";

import { APP_NAME } from "@/shared/app";

// Static export: o manifest é gerado no build, como arquivo.
export const dynamic = "force-static";

// Instalável no desktop e no Android (frontend.md, "Shell Next, PWA e rotas"). Ícones gerados de src/app/icon.svg.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Vistoria de imóveis para locação, local-first.",
    lang: "pt-BR",
    start_url: "/inspections",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/avis-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/avis-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/avis-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
