"use client";

import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  type ConflictChoice,
  ConflictResolver,
  type ConflictResolverGroup,
} from "@/shared/components/conflict-resolver";

import { PageHeader } from "./shell-header";

// A tela de conflito de um registro (wireframe 69:2632, ConflictResolver 32:1787 tipo edição), igual para vistoria,
// cliente e imóvel: só o que os dois lados mudaram. Enviar a resolução, ou "Voltar", volta para onde a pessoa estava
// (nota 69:2635); aberta direto, sem histórico, vai para o registro.

/** O que o hook de conflito da feature entrega. */
export interface ConflictState {
  /** `done`: a resolução saiu e o rascunho já não está em conflito; a tela só sai. */
  status: "loading" | "found" | "none" | "done";
  /** O registro existe neste aparelho (para "Abrir …" quando não há conflito). */
  known: boolean;
  description: string;
  mineOrigin: string;
  theirsOrigin: string;
  groups: ConflictResolverGroup[];
  summary: string;
  remaining: string;
  canSubmit: boolean;
  submitting: boolean;
  choose: (key: string, choice: ConflictChoice) => void;
  chooseAll: (choice: ConflictChoice) => void;
  submit: () => Promise<boolean>;
}

export function ConflictPage({
  conflict,
  recordHref,
  listHref,
  noConflict,
  openLabel,
}: {
  conflict: ConflictState;
  /** O registro (a tela de campo, o formulário), para onde a tela volta sem histórico. */
  recordHref: string;
  listHref: string;
  /** "Esta vistoria não tem conflito para resolver." */
  noConflict: string;
  /** "Abrir a vistoria". */
  openLabel: string;
}) {
  const router = useRouter();

  function leave() {
    if (window.history.length > 1) router.back();
    else router.replace(recordHref);
  }

  if (conflict.status === "none") {
    const href = conflict.known ? recordHref : listHref;
    return (
      <>
        <PageHeader title="Conflito" backHref={href} />
        <div className="flex flex-col items-start gap-4">
          <Alert role="status">
            <Info aria-hidden="true" />
            <AlertDescription>{noConflict}</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href={href}>{conflict.known ? openLabel : "Voltar para a lista"}</Link>
          </Button>
        </div>
      </>
    );
  }

  if (conflict.status !== "found") return <PageHeader title="Conflito" backHref={recordHref} />;

  return (
    <>
      <PageHeader title="Conflito" backHref={recordHref} />
      <ConflictResolver
        description={conflict.description}
        mineOrigin={conflict.mineOrigin}
        theirsOrigin={conflict.theirsOrigin}
        groups={conflict.groups}
        summary={conflict.summary}
        remaining={conflict.remaining}
        canSubmit={conflict.canSubmit}
        submitting={conflict.submitting}
        onChoose={conflict.choose}
        onChooseAll={conflict.chooseAll}
        onSubmit={async () => {
          if (await conflict.submit()) leave();
        }}
        onBack={leave}
      />
    </>
  );
}
