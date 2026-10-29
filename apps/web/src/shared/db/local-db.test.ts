import { createIndexedDB } from "@tanstack/db";
import { describe, expect, it, vi } from "vitest";

import { outboxName } from "../sync/outbox";
import { closeLocalDb, openLocalDb } from "./local-db";

vi.mock("@tanstack/db", () => ({
  createIndexedDB: vi.fn<() => Promise<object>>(async () => ({ close: vi.fn<() => void>() })),
}));

describe("banco local por usuário", () => {
  it("um banco por user.id, aberto uma vez; a outbox também leva o id no nome", async () => {
    const db = await openLocalDb("ana");
    await openLocalDb("ana");
    await openLocalDb("bia");

    expect(vi.mocked(createIndexedDB).mock.calls.map(([options]) => options.name)).toEqual([
      "vistoria-ana",
      "vistoria-bia",
    ]);
    expect(outboxName("ana")).toBe("vistoria-outbox-ana");
    expect(vi.mocked(createIndexedDB).mock.calls[0]?.[0].stores).toEqual([
      "clients",
      "properties",
      "inspections",
      "drafts",
      "cursors",
      "skipped",
    ]);

    await closeLocalDb("ana");
    expect(db.close).toHaveBeenCalledOnce();
    await openLocalDb("ana");
    expect(createIndexedDB).toHaveBeenCalledTimes(3);
  });
});
