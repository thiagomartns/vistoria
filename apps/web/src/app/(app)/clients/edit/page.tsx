import type { Metadata } from "next";
import { Suspense } from "react";

import { ComingSoon } from "../../coming-soon";
import { ClientId } from "./client-id";

export const metadata: Metadata = { title: "Cliente" };

// `?id=` em vez de segmento dinâmico (static export). O formulário chega na #73.
export default function ClientEditPage() {
  return (
    <>
      <Suspense fallback={null}>
        <ClientId />
      </Suspense>
      <ComingSoon />
    </>
  );
}
