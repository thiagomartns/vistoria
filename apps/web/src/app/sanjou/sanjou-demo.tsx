"use client";

import { useState } from "react";

import { Button } from "@sanjou/ui/button";
import { Checkbox } from "@sanjou/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sanjou/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@sanjou/ui/dropdown-menu";
import { Label } from "@sanjou/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";
import { Switch } from "@sanjou/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@sanjou/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@sanjou/ui/tooltip";

// Parte interativa da página de prova: estado no cliente e primitivos Radix com portal.
export function SanjouDemo() {
  const [offline, setOffline] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [condition, setCondition] = useState("bom");
  const [count, setCount] = useState(0);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Interação</h2>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch id="offline" checked={offline} onCheckedChange={setOffline} />
          <Label htmlFor="offline">Modo offline</Label>
          <span className="text-muted-foreground text-sm" data-testid="offline-state">
            {offline ? "Offline" : "Online"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id="confirmado"
            checked={confirmed}
            onCheckedChange={(value) => setConfirmed(value === true)}
          />
          <Label htmlFor="confirmado">Locatário presente</Label>
          <span className="text-muted-foreground text-sm">{confirmed ? "Sim" : "Não"}</span>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="condicao">Condição</Label>
          <Select value={condition} onValueChange={setCondition}>
            <SelectTrigger id="condicao" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="novo">Novo</SelectItem>
              <SelectItem value="bom">Bom</SelectItem>
              <SelectItem value="regular">Regular</SelectItem>
              <SelectItem value="ruim">Ruim</SelectItem>
              <SelectItem value="ausente">Ausente</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setCount(count + 1)}>
            Adicionar item
          </Button>
          <span className="text-sm">{count} itens</span>
        </div>
      </div>

      <Tabs defaultValue="entrada">
        <TabsList>
          <TabsTrigger value="entrada">Entrada</TabsTrigger>
          <TabsTrigger value="saida">Saída</TabsTrigger>
        </TabsList>
        <TabsContent value="entrada">Vistoria de entrada, feita antes da mudança.</TabsContent>
        <TabsContent value="saida">Vistoria de saída, comparada com a de entrada.</TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Abrir diálogo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Concluir vistoria</DialogTitle>
              <DialogDescription>
                Depois de concluída, a vistoria não pode mais ser editada.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>Concluir</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Minha conta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Perfil</DropdownMenuItem>
            <DropdownMenuItem variant="destructive">Sair</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">Passe o mouse</Button>
            </TooltipTrigger>
            <TooltipContent>Dica do Sanjou</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </section>
  );
}
