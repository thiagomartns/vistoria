"use client";

import { useSearchParams } from "next/navigation";

import { RemoveRoomDialog } from "@/features/templates/components/remove-room-dialog";
import { TemplateForm } from "@/features/templates/components/template-form";
import { TEMPLATES_HREF, useTemplateForm } from "@/features/templates/hooks/useTemplateForm";
import { ConflictNotice } from "@/shared/components/conflict-notice";
import { RecordUnavailable } from "@/shared/components/record-unavailable";
import { useIsLarge } from "@/shared/useIsDesktop";

import { PageHeader } from "../../shell-header";

// /templates/edit (Figma "Roteiros (#173)", estados 3 a 8): a mesma tela para novo (sem `id`, "Novo roteiro") e
// edição. A partir de 1024 px, dois painéis; abaixo, dois níveis na mesma rota (no tablet, os dois painéis não cabem,
// #208): no segundo, o cabeçalho mostra o ambiente e o "Voltar" volta aos ambientes sem navegar. Em conflito, o aviso com "Resolver conflito" acima do formulário. Um id
// que o aparelho não tem é buscado no servidor; sem rede, não encontrado ou com falha, o aviso toma o lugar do editor.

export function TemplateEditScreen() {
  const id = useSearchParams().get("id");
  const editor = useTemplateForm(id);
  const desktop = useIsLarge();
  const inRoom = !desktop && editor.open && editor.rooms[editor.selected] !== undefined;

  return (
    <>
      <PageHeader
        title={inRoom ? (editor.rooms[editor.selected]?.name ?? "") : editor.title}
        backHref={TEMPLATES_HREF}
        onBack={inRoom ? editor.close : undefined}
        sync={editor.sync}
      />
      {editor.unavailable ? (
        <RecordUnavailable {...editor.unavailable} backHref={TEMPLATES_HREF} />
      ) : editor.status === "loading" ? null : (
        <div className="flex flex-col gap-5">
          {editor.conflict && !inRoom ? <ConflictNotice {...editor.conflict} /> : null}
          <TemplateForm
            form={editor.form}
            onSubmit={editor.onSubmit}
            layout={desktop ? "desktop" : "celular"}
            rooms={editor.rooms}
            selected={editor.selected}
            open={editor.open}
            roomsMax={editor.roomsMax}
            itemsMax={editor.itemsMax}
            onSelect={editor.select}
            onAddRoom={editor.addRoom}
            onMoveRoom={editor.moveRoom}
            onRemoveRoom={editor.requestRemoveRoom}
            newItem={editor.newItem}
            rejection={inRoom ? null : editor.rejection}
            cancelHref={TEMPLATES_HREF}
          />
          <RemoveRoomDialog
            room={editor.removal}
            onConfirm={editor.confirmRemoval}
            onCancel={editor.cancelRemoval}
          />
        </div>
      )}
    </>
  );
}
