import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Avatar, AvatarFallback } from "@sanjou/ui/avatar";
import { Badge } from "@sanjou/ui/badge";
import { Button } from "@sanjou/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@sanjou/ui/card";
import { Input } from "@sanjou/ui/input";
import { Label } from "@sanjou/ui/label";
import { Separator } from "@sanjou/ui/separator";
import { Skeleton } from "@sanjou/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";

import { SanjouDemo } from "./sanjou-demo";

export const metadata: Metadata = {
  title: "Prova do Sanjou UI",
};

// Página de prova da issue #11: o Sanjou UI renderiza e interage no static export.
// Sai quando o shell chegar; não é rota do produto.
export default function SanjouProofPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Prova do Sanjou UI</h1>
        <p className="text-muted-foreground">
          Componentes do pacote <code className="font-mono">@sanjou/ui</code> no static export.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Botões e badges</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="brand">Marca</Button>
          <Button variant="destructive">Excluir</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="neutral">Rascunho</Badge>
          <Badge variant="brand">Em andamento</Badge>
          <Badge variant="success">Sincronizado</Badge>
          <Badge variant="warning">Conflito</Badge>
          <Badge variant="danger">Rejeitado</Badge>
        </div>
      </section>

      <Alert variant="warning">
        <AlertTitle>Ação necessária</AlertTitle>
        <AlertDescription>
          Uma alteração colidiu com outra feita em outro aparelho.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Imóvel</CardTitle>
          <CardDescription>Dados básicos para a vistoria de entrada.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="endereco">Endereço</Label>
            <Input id="endereco" placeholder="Rua, número e complemento" />
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>TM</AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ambiente</TableHead>
            <TableHead>Itens</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Sala</TableCell>
            <TableCell>8</TableCell>
            <TableCell>
              <Badge variant="success">Sincronizado</Badge>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Cozinha</TableCell>
            <TableCell>12</TableCell>
            <TableCell>
              <Badge variant="neutral">Rascunho</Badge>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <SanjouDemo />
    </main>
  );
}
