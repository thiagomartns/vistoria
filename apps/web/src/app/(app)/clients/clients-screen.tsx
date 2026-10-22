"use client";

import { Button } from "@sanjou/ui/button";
import { Input } from "@sanjou/ui/input";
import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";

import { ClientsList } from "@/features/clients/components/clients-list";
import { useClients } from "@/features/clients/hooks/useClients";
import { EmptyState } from "@/shared/components/empty-state";

// /clients (Figma 70:2405 desktop, 70:2564 celular): busca local, "Novo cliente" e a lista em ordem alfabética.
// Sem menu de ações: cliente não é excluído na V1 (nota 70:2718).

const NEW_CLIENT_HREF = "/clients/edit";

export function ClientsScreen() {
  const { ready, empty, rows, search, setSearch } = useClients();

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
      <div className="flex flex-col gap-3 md:flex-row md:gap-2">
        <Input
          type="search"
          aria-label="Buscar clientes"
          placeholder="Buscar por nome, documento ou e-mail"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="md:flex-1"
        />
        <Button asChild size="lg" className="w-full md:h-8 md:w-auto md:px-3">
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
        <ClientsList items={rows} />
      )}
    </>
  );
}
