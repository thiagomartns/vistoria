"use client";

import { useEffect } from "react";

// Registra o service worker do static export. Em dev não há sw.js (o `serwist build` roda depois do `next build`),
// e um SW de uma build antiga serviria arquivos velhos ao `next dev`.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.warn("[pwa] service worker não registrado", error);
    });
  }, []);
  return null;
}
