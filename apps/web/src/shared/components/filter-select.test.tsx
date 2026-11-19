import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterSelect } from "./filter-select";

const CLIENTS = [
  { value: "c1", label: "Imobiliária Horizonte" },
  { value: "c2", label: "Lar Imóveis" },
];

describe("FilterSelect", () => {
  it("barra: o nome do filtro no texto, com o valor ou 'todos'", () => {
    const view = render(
      <FilterSelect
        label="Cliente"
        allLabel="Todos"
        value={null}
        options={CLIENTS}
        onChange={() => {}}
        layout="barra"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Filtrar por cliente" });
    expect(trigger.textContent).toBe("Cliente: todos");

    view.rerender(
      <FilterSelect
        label="Cliente"
        allLabel="Todos"
        value="c2"
        options={CLIENTS}
        onChange={() => {}}
        layout="barra"
      />,
    );
    expect(trigger.textContent).toBe("Cliente: Lar Imóveis");
  });

  it("painel: o Label em cima, ligado ao Select, e o Select só com o valor", () => {
    render(
      <FilterSelect
        label="Período"
        allLabel="Qualquer data"
        value={null}
        options={[{ value: "7d", label: "Últimos 7 dias" }]}
        onChange={() => {}}
        layout="painel"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Filtrar por período" });

    expect(trigger.textContent).toBe("Qualquer data");
    expect(screen.getByText("Período").getAttribute("for")).toBe(trigger.id);
  });

  it("escolher um valor e voltar a 'todos'", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: string | null) => void>();
    const view = render(
      <FilterSelect
        label="Cliente"
        allLabel="Todos"
        value={null}
        options={CLIENTS}
        onChange={onChange}
        layout="barra"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Filtrar por cliente" }));
    await user.click(await screen.findByRole("option", { name: "Lar Imóveis" }));
    expect(onChange).toHaveBeenLastCalledWith("c2");

    view.rerender(
      <FilterSelect
        label="Cliente"
        allLabel="Todos"
        value="c2"
        options={CLIENTS}
        onChange={onChange}
        layout="barra"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Filtrar por cliente" }));
    await user.click(await screen.findByRole("option", { name: "Todos" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("opções em função: só são montadas com o Select aberto, e o texto do escolhido vem do selectedLabel", async () => {
    const user = userEvent.setup();
    const options = vi.fn<() => typeof CLIENTS>(() => CLIENTS);
    render(
      <FilterSelect
        label="Cliente"
        allLabel="Todos"
        value="c1"
        selectedLabel="Imobiliária Horizonte"
        options={options}
        onChange={() => {}}
        layout="barra"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Filtrar por cliente" }).textContent).toBe(
      "Cliente: Imobiliária Horizonte",
    );
    expect(options).not.toHaveBeenCalled();

    await user.click(screen.getByRole("combobox", { name: "Filtrar por cliente" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Todos",
      "Imobiliária Horizonte",
      "Lar Imóveis",
    ]);
    expect(options).toHaveBeenCalled();
  });

  it("a barra e o painel juntos não repetem o id do Select", () => {
    render(
      <>
        <FilterSelect
          label="Cliente"
          allLabel="Todos"
          value={null}
          options={CLIENTS}
          onChange={() => {}}
          layout="barra"
        />
        <FilterSelect
          label="Cliente"
          allLabel="Todos"
          value={null}
          options={CLIENTS}
          onChange={() => {}}
          layout="painel"
        />
      </>,
    );
    const [bar, panel] = screen.getAllByRole("combobox", { name: "Filtrar por cliente" });

    expect(bar!.id).not.toBe(panel!.id);
  });
});
