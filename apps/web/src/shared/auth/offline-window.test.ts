import { describe, expect, it } from "vitest";

import { OFFLINE_WINDOW_MS, offlineWindowExpired } from "./offline-window";

const renewedAt = new Date("2026-10-28T12:00:00Z");
const after = (ms: number) => new Date(renewedAt.getTime() + ms);
const MINUTE = 60 * 1000;

describe("offlineWindowExpired", () => {
  it("vale 72 h, a linha de Parâmetros do backend.md", () => {
    expect(OFFLINE_WINDOW_MS).toBe(72 * 60 * MINUTE);
  });

  it("dentro das 72 h, e nas 72 h exatas, não venceu", () => {
    expect(offlineWindowExpired(renewedAt, after(MINUTE))).toBe(false);
    expect(offlineWindowExpired(renewedAt, after(OFFLINE_WINDOW_MS))).toBe(false);
  });

  it("72 h + 1 min depois da última renovação aceita, venceu", () => {
    expect(offlineWindowExpired(renewedAt, after(OFFLINE_WINDOW_MS + MINUTE))).toBe(true);
  });

  it("sem a data da última renovação, vale como vencida", () => {
    expect(offlineWindowExpired(null, renewedAt)).toBe(true);
  });
});
