"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AvisLockup } from "@/shared/components/avis-lockup";

// A lista de vistorias é a entrada do app. Sem servidor, o redirecionamento é no cliente.
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/inspections");
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <h1>
        <AvisLockup layout="vertical" caption />
      </h1>
    </main>
  );
}
