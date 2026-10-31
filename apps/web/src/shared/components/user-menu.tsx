import { Avatar, AvatarFallback } from "@sanjou/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@sanjou/ui/dropdown-menu";
import { ChevronDown, LogOut } from "lucide-react";

// Usuário do shell: rodapé da sidebar no desktop, avatar no header do celular; os dois abrem o mesmo menu
// (nome, separador e Sair com o ícone LogOut, frame 3 da #128). Sem sessão, "?" e "Entrar".

/** "Thiago Martins" → "TM"; "Ana" → "A". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : words.slice(0, 1);
  return letters.map((word) => word?.[0]?.toLocaleUpperCase("pt-BR") ?? "").join("");
}

type UserMenuProps = {
  user: { name: string } | null;
  layout: "sidebar" | "avatar";
  onSignOut: () => void;
  onSignIn: () => void;
};

export function UserMenu({ user, layout, onSignOut, onSignIn }: UserMenuProps) {
  const initials = user ? initialsOf(user.name) : "?";
  const avatar = (
    <Avatar className="shrink-0">
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
  const focus = "outline-none focus-visible:outline-2 focus-visible:outline-ring";

  return (
    // Sem modal: o Sair pode abrir um Dialog, e o menu fecha antes sem disputar o foco e o pointer-events do body.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {layout === "sidebar" ? (
          <button
            type="button"
            aria-label="Menu do usuário"
            className={`flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left hover:bg-accent ${focus}`}
          >
            {avatar}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {user?.name ?? "Sem sessão"}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Menu do usuário"
            className={`flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full ${focus}`}
          >
            {avatar}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {user ? (
          <>
            <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSignOut}>
              <LogOut aria-hidden="true" />
              Sair
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={onSignIn}>Entrar</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
