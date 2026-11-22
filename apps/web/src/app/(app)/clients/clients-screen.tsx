"use client";

import { Button } from "@sanjou/ui/button";
import { Input } from "@sanjou/ui/input";
import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";

import { ClientsList } from "@/features/clients/components/clients-list";
import { useClients } from "@/features/clients/hooks/useClients";
import { EmptyState } from "@/shared/components/empty-state";
import { useIsLarge } from "@/shared/useIsDesktop";

// /clients (Figma 70:2405 desktop, 70:2564 celular): busca local, "Novo cliente" e a lista em ordem alfabética.
// Sem menu de ações: cliente não é excluído na V1 (nota 70:2718). A lista monta 50 linhas por vez, com "Mostrar mais"
// e o contador no desktop, como /inspections, e só a versão da largura (#223).

const NEW_CLIENT_HREF = "/clients/edit";

export function ClientsScreen() {
  const { ready, empty, rows, count, hidden, showMore, search, setSearch } = useClients();
  const large = useIsLarge();

  if (!ready) return null;

  if (empty) {
    return (
      <EmptyState
        icon={Building2}
        title="Nenhum cliente ainda"
        description="Cadastre as imobiliárias e os proprietários que contratam suas vistorias."
        action={
          <Button asChild>
            <Link href={NEW_CLIENT_HREF}>
              <Plus aria-hidden="true" />
              Novo cliente
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:gap-2">
        <Input
          type="search"
          aria-label="Buscar clientes"
          placeholder="Buscar por nome, documento, telefone ou e-mail"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="lg:flex-1"
        />
        <Button asChild size="lg" className="w-full lg:h-8 lg:w-auto lg:px-3">
          <Link href={NEW_CLIENT_HREF}>
            <Plus aria-hidden="true" />
            Novo cliente
          </Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum cliente encontrado"
          description="Confira a busca ou cadastre um cliente novo."
        />
      ) : (
        <>
          <ClientsList items={rows} layout={large ? "tabela" : "linhas"} />
          {hidden > 0 ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full lg:h-8 lg:w-auto lg:self-center lg:px-3"
              onClick={showMore}
            >
              Mostrar mais
            </Button>
          ) : null}
          <p className="hidden text-sm text-muted-foreground lg:block">{count}</p>
        </>
      )}
    </>
  );
}
