"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { Badge } from "@sanjou/ui/badge";
import { Button } from "@sanjou/ui/button";
import { Input } from "@sanjou/ui/input";
import { Label } from "@sanjou/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";

import { useClients } from "@/features/clients/hooks/useClients";
import { useSession } from "@/shared/auth/useSession";

// Parte interativa da prova: criar e editar um client e ver a outbox, no banco local de quem entrou. Entrar é pelo
// /login (#72). Os data-testid são do roteiro.
export function OutboxProof() {
  const session = useSession();
  const { ready, clients, pending, save } = useClients();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = clients.find((client) => client.id === editingId);
    save({
      id: current?.id,
      name,
      document: current?.document ?? null,
      email: current?.email ?? null,
      phone: current?.phone ?? null,
    });
    setEditingId(null);
    setName("");
  };

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sessão</h2>
        {session.status === "active" ? (
          <Badge variant="success" data-testid="session">
            Sessão ativa · {session.user?.name}
          </Badge>
        ) : (
          <p className="text-sm" data-testid="no-session">
            {session.status === "expired" ? "Sessão expirada. " : "Sem sessão. "}
            <Link href="/login" className="font-medium text-brand-text">
              Entrar
            </Link>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{editingId ? "Editar client" : "Novo client"}</h2>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSave}>
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <Button type="submit" disabled={!ready}>
            {editingId ? "Salvar" : "Criar"}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Clients no aparelho</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id} data-testid="client" data-id={client.id}>
                <TableCell data-testid="client-name">{client.name}</TableCell>
                <TableCell>
                  {pending.some((write) => write.recordId === client.id) ? (
                    <Badge variant="neutral">Só no aparelho</Badge>
                  ) : (
                    <Badge variant="success">Sincronizado</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingId(client.id);
                      setName(client.name);
                    }}
                  >
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Outbox <span data-testid="outbox-count">{pending.length}</span>
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Idempotency-Key</TableHead>
              <TableHead>Tentativas</TableHead>
              <TableHead>Último erro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((write) => (
              <TableRow key={write.id} data-testid="outbox-entry" data-record={write.recordId}>
                <TableCell className="font-mono text-xs" data-testid="outbox-key">
                  {write.idempotencyKey}
                </TableCell>
                <TableCell data-testid="outbox-retries">{write.retryCount}</TableCell>
                <TableCell className="text-xs">{write.lastError ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}
