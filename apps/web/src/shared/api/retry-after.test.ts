// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readRetryAfter } from "./retry-after";

describe("readRetryAfter", () => {
  it("segundos viram ms", () => {
    expect(readRetryAfter(new Response(null, { headers: { "Retry-After": "2" } }))).toBe(2_000);
  });

  it("ausente, ilegível ou data HTTP → undefined; acima de 60 s, 60 s", () => {
    expect(readRetryAfter(new Response(null))).toBeUndefined();
    expect(readRetryAfter(undefined)).toBeUndefined();
    expect(
      readRetryAfter(new Response(null, { headers: { "Retry-After": "dois" } })),
    ).toBeUndefined();
    expect(
      readRetryAfter(new Response(null, { headers: { "Retry-After": "-1" } })),
    ).toBeUndefined();
    expect(
      readRetryAfter(
        new Response(null, { headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" } }),
      ),
    ).toBeUndefined();
    expect(readRetryAfter(new Response(null, { headers: { "Retry-After": "3600" } }))).toBe(60_000);
  });
});
