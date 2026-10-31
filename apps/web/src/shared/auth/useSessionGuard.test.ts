// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { SessionSnapshot } from "./session";
import { afterSignIn } from "./useAuthForm";
import { shellRedirect } from "./useSessionGuard";

const user = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Ana" };
const session = (status: SessionSnapshot["status"], ready = true): SessionSnapshot => ({
  ready,
  status,
  user: status === "signed-out" ? null : user,
});

describe("shellRedirect", () => {
  it.each([
    ["sem dono, online", session("signed-out"), true, "/login"],
    [
      "sem dono, offline (1º acesso pede conexão no /login)",
      session("signed-out"),
      false,
      "/login",
    ],
    ["sessão ativa", session("active"), true, null],
    ["renovando (abriu com rede): o refresh decide", session("renewing"), true, null],
    ["sessão expirada, offline: fica com os dados locais", session("expired"), false, null],
    ["sessão expirada, rede de volta: SessionExpired", session("expired"), true, "/login"],
    ["antes de ler o localStorage, nada", session("signed-out", false), true, null],
  ])("%s", (_, snapshot, online, target) => {
    expect(shellRedirect(snapshot, online)).toBe(target);
  });
});

describe("afterSignIn", () => {
  it.each([
    ["", "/inspections"],
    ["?next=%2Fclients%2Fedit%3Fid%3Dc1", "/clients/edit?id=c1"],
    ["?next=%2F%2Fevil.example", "/inspections"],
    ["?next=%2F%5Cevil.example", "/inspections"],
    ["?next=https%3A%2F%2Fevil.example", "/inspections"],
  ])("%s → %s", (search, target) => {
    expect(afterSignIn(search)).toBe(target);
  });
});
