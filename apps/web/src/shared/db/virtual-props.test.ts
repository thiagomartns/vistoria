import { describe, expect, it } from "vitest";

import { withoutVirtualProps } from "./virtual-props";

describe("withoutVirtualProps (#211)", () => {
  it("tira as props virtuais do TanStack DB e mantém o resto, sem mexer no aninhado", () => {
    const rooms = [{ id: "r1", name: "Sala" }];
    const row = {
      id: "v1",
      version: null,
      rooms,
      $hasPendingWrites: true,
      $origin: "local",
      $key: "v1",
      $collectionId: "inspections",
    };

    const plain = withoutVirtualProps(row);

    expect(plain).toEqual({ id: "v1", version: null, rooms });
    expect(plain.rooms).toBe(rooms);
    expect(row.$hasPendingWrites).toBe(true);
  });

  it("sem prop virtual, devolve o mesmo objeto", () => {
    const row = { id: "v1", name: "Ana" };
    expect(withoutVirtualProps(row)).toBe(row);
  });
});
