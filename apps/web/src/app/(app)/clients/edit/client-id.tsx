"use client";

import { useSearchParams } from "next/navigation";

export function ClientId() {
  const id = useSearchParams().get("id");
  return (
    <p className="text-sm text-muted-foreground" data-testid="client-id">
      {id ? `Cliente ${id}` : "Cliente novo"}
    </p>
  );
}
