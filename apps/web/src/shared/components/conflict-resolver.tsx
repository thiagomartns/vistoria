"use client";

import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@sanjou/ui/radio-group";
import { Separator } from "@sanjou/ui/separator";
import { Circle, CircleCheck, Cloud, type LucideIcon, Smartphone, Trash2 } from "lucide-react";
import { Fragment } from "react";

import { SyncBadge } from "./sync-badge";

// O ConflictResolver tipo edição (Figma 32:1787) e o campo em disputa (ConflictResolver/Campo 30:1431): só o que os
// dois lados mudaram, agrupado por ambiente, com "Neste aparelho" ou "No servidor" por campo. O campo é um radiogroup
// do Sanjou com o cartão inteiro clicável; o escolhido ganha borda primary de 2 px, fundo accent e o CircleCheck, então
// a escolha não depende só da cor. Lado a lado a partir de `md` (largo), empilhado abaixo (estreito). O tipo excluído
// (32:1472) e o tipo exclusão alterada (32:1514, um Dialog do Sanjou) ficam no fim (ADR 0040). Específico do vistoria
// (ADR 0020).

export type ConflictChoice = "meu" | "servidor";

interface Side {
  /** "Neste aparelho · 15:02". */
  origin: string;
  value: string;
}

type ConflictFieldProps = {
  /** "Piso · Condição": também o nome do radiogroup. */
  label: string;
  /** "Antes: Bom". */
  before?: string | null;
  mine: Side;
  theirs: Side;
  choice?: ConflictChoice;
  onChoose: (choice: ConflictChoice) => void;
};

function Option({
  value,
  side,
  icon: Origin,
  chosen,
}: {
  value: ConflictChoice;
  side: Side;
  icon: LucideIcon;
  chosen: boolean;
}) {
  const Mark = chosen ? CircleCheck : Circle;
  return (
    <label
      data-chosen={chosen}
      className={`relative flex cursor-pointer gap-3 rounded-md md:flex-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
        chosen
          ? "border-2 border-primary bg-accent p-[11px]"
          : "border border-border bg-background p-3"
      }`}
    >
      {/* O radio do Sanjou dá a semântica e o teclado; o que se vê é o ícone do Figma, por cima dele. */}
      <RadioGroupItem value={value} className="absolute top-3.5 left-3 opacity-0" />
      <span className="pt-0.5">
        <Mark className="size-4 text-foreground" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Origin className="size-3" aria-hidden="true" />
          {side.origin}
        </span>
        <span className="text-base font-medium break-words text-foreground">{side.value}</span>
      </span>
    </label>
  );
}

export function ConflictField({
  label,
  before,
  mine,
  theirs,
  choice,
  onChoose,
}: ConflictFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="shrink-0 text-sm font-medium text-foreground">{label}</p>
        {/* Um "Antes" longo (uma observação) quebra, não o nome do campo. */}
        {before ? (
          <p className="min-w-0 text-right text-xs break-words text-muted-foreground">{before}</p>
        ) : null}
      </div>
      <RadioGroup
        aria-label={label}
        value={choice ?? ""}
        onValueChange={(value) => onChoose(value as ConflictChoice)}
        className="flex flex-col gap-2 md:flex-row"
      >
        <Option value="meu" side={mine} icon={Smartphone} chosen={choice === "meu"} />
        <Option value="servidor" side={theirs} icon={Cloud} chosen={choice === "servidor"} />
      </RadioGroup>
    </div>
  );
}

export interface ConflictResolverField {
  key: string;
  label: string;
  before: string | null;
  mine: string;
  theirs: string;
  choice?: ConflictChoice;
}

export interface ConflictResolverGroup {
  id: string;
  /** "Cozinha", "Geral". */
  title: string;
  fields: ConflictResolverField[];
}

type ConflictResolverProps = {
  /** "Apto 302, R. das Flores · Vistoria de entrada. Ela foi alterada em outro aparelho…". */
  description: string;
  /** "Neste aparelho · 15:02" e "No servidor · 14:58". */
  mineOrigin: string;
  theirsOrigin: string;
  groups: ConflictResolverGroup[];
  /** "1 de 3 campos resolvidos". */
  summary: string;
  /** "Faltam 2 campos". */
  remaining: string;
  /** Todos os campos têm escolha. */
  canSubmit: boolean;
  submitting?: boolean;
  onChoose: (key: string, choice: ConflictChoice) => void;
  onChooseAll: (choice: ConflictChoice) => void;
  onSubmit: () => void;
  onBack: () => void;
};

export function ConflictResolver({
  description,
  mineOrigin,
  theirsOrigin,
  groups,
  summary,
  remaining,
  canSubmit,
  submitting = false,
  onChoose,
  onChooseAll,
  onSubmit,
  onBack,
}: ConflictResolverProps) {
  return (
    <section
      aria-labelledby="resolver-conflito"
      className="flex w-full max-w-[720px] flex-col gap-6 bg-background py-2 md:p-6"
    >
      <div className="flex flex-col items-start gap-2">
        <SyncBadge state="conflito" />
        <h2 id="resolver-conflito" className="text-lg font-semibold text-foreground">
          Resolver conflito
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 md:flex-row md:items-center md:justify-between">
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          {summary}
        </p>
        {groups.length > 0 ? (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => onChooseAll("meu")}>
              Usar todos os meus
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onChooseAll("servidor")}>
              Usar todos do servidor
            </Button>
          </div>
        ) : null}
      </div>
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <Separator /> : null}
          <section aria-label={group.title} className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-foreground">{group.title}</h3>
            {group.fields.map((field) => (
              <ConflictField
                key={field.key}
                label={field.label}
                before={field.before}
                mine={{ origin: mineOrigin, value: field.mine }}
                theirs={{ origin: theirsOrigin, value: field.theirs }}
                choice={field.choice}
                onChoose={(choice) => onChoose(field.key, choice)}
              />
            ))}
          </section>
        </Fragment>
      ))}
      <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">{remaining}</p>
        {/* No celular, a ação principal primeiro; no desktop, Voltar à esquerda. */}
        <div className="flex flex-col gap-2 md:flex-row-reverse">
          <Button
            size="lg"
            className="w-full md:h-8 md:w-auto md:px-3"
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
          >
            Enviar resolução
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full md:h-8 md:w-auto md:px-3"
            onClick={onBack}
          >
            Voltar
          </Button>
        </div>
      </div>
    </section>
  );
}

type DeletedConflictProps = {
  /** "Apto 302, R. das Flores · Vistoria de entrada. Ela foi excluída em outro aparelho, …". */
  description: string;
  /** "Excluída às 14:58 em outro aparelho". */
  deleted: string;
  /** "Neste aparelho: 12 itens alterados em 4 ambientes. Recriar gera uma vistoria nova, com outro código." */
  changes: string;
  busy?: boolean;
  onRecreate: () => void;
  onDiscard: () => void;
};

/** O ConflictResolver tipo excluído (Figma 32:1472 e 32:1710): recriar com os mesmos dados ou descartar. */
export function DeletedConflict({
  description,
  deleted,
  changes,
  busy = false,
  onRecreate,
  onDiscard,
}: DeletedConflictProps) {
  return (
    <section
      aria-labelledby="vistoria-excluida"
      className="flex w-full max-w-[720px] flex-col gap-6 bg-background py-2 md:p-6"
    >
      <div className="flex flex-col items-start gap-2">
        <SyncBadge state="conflito" />
        <h2 id="vistoria-excluida" className="text-lg font-semibold text-foreground">
          Vistoria excluída em outro aparelho
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-3 rounded-lg border border-border px-4 py-3">
        <Trash2 className="size-4 shrink-0 text-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <p className="font-medium text-foreground">{deleted}</p>
          <p className="text-muted-foreground">{changes}</p>
        </div>
      </div>
      {/* No celular, empilhados com a ação principal primeiro; no desktop, à direita, Recriar por último. */}
      <div className="flex flex-col gap-2 border-t border-border pt-4 md:flex-row-reverse md:justify-start">
        <Button
          size="lg"
          className="w-full md:h-8 md:w-auto md:px-3"
          disabled={busy}
          onClick={onRecreate}
        >
          Recriar vistoria
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="w-full md:h-8 md:w-auto md:px-3"
          disabled={busy}
          onClick={onDiscard}
        >
          Descartar alterações
        </Button>
      </div>
    </section>
  );
}

export const REMOVAL_CONFLICT_TITLE = "Excluir mesmo assim?";

type RemovalConflictDialogProps = {
  open: boolean;
  /** O × e o Esc: sai sem decidir, e o conflito fica. */
  onDismiss: () => void;
  /** "Cancelar": fica com a vistoria como o servidor a tem. */
  onKeep: () => void;
  /** "Excluir vistoria": a exclusão volta para a fila, com a versão nova. */
  onConfirm: () => void;
};

/** O ConflictResolver tipo exclusão alterada (Figma 32:1514 e 32:1752): o Dialog do Sanjou sobre a tela de campo. */
export function RemovalConflictDialog({
  open,
  onDismiss,
  onKeep,
  onConfirm,
}: RemovalConflictDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{REMOVAL_CONFLICT_TITLE}</DialogTitle>
          <DialogDescription>
            Esta vistoria foi alterada em outro aparelho depois que você a abriu. Ao excluir, as
            alterações feitas lá também se perdem.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onKeep}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Excluir vistoria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
