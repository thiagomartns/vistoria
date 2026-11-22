import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@sanjou/ui/form";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { type SearchOption, SearchSelect, searchRows } from "./search-select";

// 2.500 imóveis, como os do `pnpm seed`: "Rua 0001, 10" … "Rua 2500, 10", e um com acento no meio.
const PLACES: SearchOption[] = Array.from({ length: 2500 }, (_, i) => ({
  value: `p${i + 1}`,
  label: i === 1999 ? "Rua São José, 2000" : `Rua ${String(i + 1).padStart(4, "0")}, 10`,
}));

function renderFilter(props: Partial<Parameters<typeof SearchSelect>[0]> = {}) {
  const onChange = vi.fn<(value: string | null) => void>();
  const view = render(
    <SearchSelect
      label="Imóvel"
      allLabel="Todos"
      emptyText="Nenhum imóvel encontrado"
      value={null}
      options={PLACES}
      onChange={onChange}
      layout="barra"
      {...props}
    />,
  );
  return { onChange, view, trigger: screen.getByRole("combobox", { name: "Filtrar por imóvel" }) };
}

describe("searchRows", () => {
  it("monta no máximo `limit`, com o 'todos' em cima e as que sobram contadas", () => {
    const { rows, more } = searchRows(PLACES, "", { value: null, allLabel: "Todos", limit: 50 });
    expect(rows).toHaveLength(51);
    expect(rows[0]?.label).toBe("Todos");
    expect(more).toBe(2450);
  });

  it("o escolhido fora das primeiras vem logo depois do 'todos', sem sair da conta", () => {
    const { rows, more } = searchRows(PLACES, "", { value: "p2000", allLabel: "Todos", limit: 50 });
    expect(rows.slice(0, 3).map((row) => row.label)).toEqual([
      "Todos",
      "Rua São José, 2000",
      "Rua 0001, 10",
    ]);
    expect(more).toBe(2450);
  });

  it("busca sem acento e sem caixa", () => {
    const { rows, matched } = searchRows(PLACES, "  SAO jose ", { value: null, limit: 50 });
    expect(rows.map((row) => row.label)).toEqual(["Rua São José, 2000"]);
    expect(matched).toBe(1);
  });
});

describe("SearchSelect", () => {
  it("fechado, não lê nem monta nenhuma opção", () => {
    const options = vi.fn<() => SearchOption[]>(() => PLACES);
    const { trigger } = renderFilter({ options, selectedLabel: null });
    expect(trigger.textContent).toBe("Imóvel: todos");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(options).not.toHaveBeenCalled();
  });

  it("aberto, monta o 'todos' e 50 opções, com 'Mais 2.450: refine a busca' fora do listbox", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter();
    await user.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Imóvel" });
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(51);
    expect(options[0]?.textContent).toBe("Todos");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Mais 2.450: refine a busca")).toBeTruthy();
    expect(listbox.contains(screen.getByText("Mais 2.450: refine a busca"))).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Buscar imóvel" }));
  });

  it("a busca acha sem acento, e Enter escolhe a primeira que casa", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.click(screen.getByRole("combobox", { name: "Filtrar por imóvel" }));
    await user.keyboard("sao jose");

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Todos", "Rua São José, 2000"]);
    expect(screen.queryByText(/refine a busca/)).toBeNull();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("p2000");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("o escolhido, fora das 50 primeiras, aparece aberto e marcado", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter({ value: "p2000" });
    expect(trigger.textContent).toBe("Imóvel: Rua São José, 2000");
    await user.click(trigger);

    const chosen = screen.getByRole("option", { name: "Rua São José, 2000" });
    expect(chosen.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("combobox", { name: "Buscar imóvel" }).getAttribute("aria-activedescendant"),
    ).toBe(chosen.id);
  });

  it("setas, Home e End movem o destaque pelo aria-activedescendant; 'todos' desliga o filtro", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilter({ value: "p1" });
    await user.click(screen.getByRole("combobox", { name: "Filtrar por imóvel" }));
    const search = screen.getByRole("combobox", { name: "Buscar imóvel" });
    const highlighted = () =>
      document.getElementById(search.getAttribute("aria-activedescendant") ?? "");

    expect(highlighted()?.textContent).toBe("Rua 0001, 10");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(highlighted()?.textContent).toBe("Rua 0003, 10");
    await user.keyboard("{End}");
    expect(highlighted()?.textContent).toBe("Rua 0050, 10");
    await user.keyboard("{Home}");
    expect(highlighted()?.textContent).toBe("Todos");
    expect(highlighted()?.hasAttribute("data-highlighted")).toBe(true);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("Esc fecha sem escolher e devolve o foco ao gatilho", async () => {
    const user = userEvent.setup();
    const { onChange, trigger } = renderFilter();
    await user.click(trigger);
    await user.keyboard("rua 0007{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("sem resultado, o 'todos' fica e o aviso aparece", async () => {
    const user = userEvent.setup();
    renderFilter();
    await user.click(screen.getByRole("combobox", { name: "Filtrar por imóvel" }));
    await user.keyboard("rua xavier");

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Todos"]);
    expect(screen.getByText("Nenhum imóvel encontrado")).toBeTruthy();
  });

  it("o clique numa opção escolhe e fecha", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.click(screen.getByRole("combobox", { name: "Filtrar por imóvel" }));
    await user.click(screen.getByRole("option", { name: "Rua 0004, 10" }));
    expect(onChange).toHaveBeenCalledWith("p4");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("painel: o Label em cima, ligado ao gatilho, e o gatilho só com o valor", () => {
    render(
      <SearchSelect
        label="Cliente"
        allLabel="Todos"
        value={null}
        options={[]}
        onChange={() => {}}
        layout="painel"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Filtrar por cliente" });
    expect(trigger.textContent).toBe("Todos");
    expect(screen.getByText("Cliente").getAttribute("for")).toBe(trigger.id);
  });

  describe("campo, dentro do FormControl", () => {
    function PropertyField({ onSubmit }: { onSubmit: (values: { propertyId: string }) => void }) {
      const form = useForm({ defaultValues: { propertyId: "" } });
      return (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => {
              if (values.propertyId === "")
                form.setError("propertyId", { message: "Escolha o imóvel." });
              else onSubmit(values);
            })}
          >
            <FormField
              control={form.control}
              name="propertyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Imóvel</FormLabel>
                  <FormControl>
                    <SearchSelect
                      label="Imóvel"
                      layout="campo"
                      placeholder="Escolha o imóvel"
                      value={field.value === "" ? null : field.value}
                      options={() => PLACES}
                      selectedLabel={
                        PLACES.find((place) => place.value === field.value)?.label ?? null
                      }
                      onChange={(value) => field.onChange(value ?? "")}
                      ref={field.ref}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <button type="submit">Começar</button>
          </form>
        </Form>
      );
    }

    it("o Label nomeia o gatilho, sem 'todos'; o erro marca aria-invalid e é descrito", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn<(values: { propertyId: string }) => void>();
      render(<PropertyField onSubmit={onSubmit} />);
      const trigger = screen.getByRole("combobox", { name: "Imóvel" });
      expect(trigger.textContent).toBe("Escolha o imóvel");
      expect(trigger?.hasAttribute("data-placeholder")).toBe(true);

      await user.click(screen.getByRole("button", { name: "Começar" }));
      expect(trigger.getAttribute("aria-invalid")).toBe("true");
      expect(
        document.getElementById(trigger.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toBe("Escolha o imóvel.");

      await user.click(trigger);
      expect(screen.queryByRole("option", { name: "Todos" })).toBeNull();
      await user.keyboard("2000{Enter}");
      expect(trigger.textContent).toBe("Rua São José, 2000");
      await user.click(screen.getByRole("button", { name: "Começar" }));
      expect(onSubmit).toHaveBeenCalledWith({ propertyId: "p2000" });
    });
  });
});
