import { describe, expect, it } from "vitest";

import { isNewer, rowversionOf, versionOf } from "./version";

// A `version` do contrato é o rowversion em base64 (ADR 0047): o pull compara a idade de duas pela ordem dele.

describe("rowversion da version", () => {
  it("lê o base64 de 8 bytes da API como número, e escreve de volta igual", () => {
    expect(rowversionOf("AAAAAAAAB9M=")).toBe(2003n);
    expect(versionOf(2003)).toBe("AAAAAAAAB9M=");
    expect(rowversionOf(versionOf(2n ** 63n))).toBe(2n ** 63n);
  });

  it("vazia, nula ou fora do base64 de até 8 bytes não é rowversion", () => {
    expect(rowversionOf(null)).toBeNull();
    expect(rowversionOf("")).toBeNull();
    expect(rowversionOf("não é base64")).toBeNull();
    expect(rowversionOf(btoa("123456789"))).toBeNull();
  });

  it("a mais nova é a de rowversion maior, byte a byte, não a ordem do texto", () => {
    // 13 é "…AA0=" e 12 é "…AAw=": no texto, o "0" vem antes do "w".
    const [thirteen, twelve] = [versionOf(13), versionOf(12)];
    expect([thirteen, twelve]).toEqual(["AAAAAAAAAA0=", "AAAAAAAAAAw="]);
    expect(thirteen < twelve).toBe(true);
    expect(isNewer(thirteen, twelve)).toBe(true);
    expect(isNewer(versionOf(256), versionOf(255))).toBe(true);
    expect(isNewer(versionOf(255), versionOf(256))).toBe(false);
    expect(isNewer(versionOf(7), versionOf(7))).toBe(false);
  });

  it("uma version ilegível ou ausente nunca é mais nova, nem faz a outra ser", () => {
    expect(isNewer(undefined, versionOf(1))).toBe(false);
    expect(isNewer(versionOf(1), null)).toBe(false);
    expect(isNewer("???", versionOf(1))).toBe(false);
  });
});
