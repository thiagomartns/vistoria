// A `version` do contrato é o rowversion do SQL Server em base64 (backend.md, "Entidade sincronizável" e "Leitura por delta"): 8 bytes que só crescem,
// a cada escrita no banco inteiro. Comparar duas diz qual delas o servidor gravou depois, sem guardar a store inteira
// para saber se ela mudou (ADR 0047).

const BYTES = 8;

/** O rowversion de uma `version`, ou null se ela não for um (vazia, ou fora do base64 de até 8 bytes). */
export function rowversionOf(version: string | null | undefined): bigint | null {
  if (!version) return null;
  let bytes: string;
  try {
    bytes = atob(version);
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > BYTES) return null;
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes.charCodeAt(i));
  return value;
}

/** `a` foi gravada pelo servidor depois de `b`. Uma `version` ilegível não é mais nova que nenhuma. */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const first = rowversionOf(a);
  const second = rowversionOf(b);
  return first !== null && second !== null && first > second;
}

/** A `version` do rowversion `n`, como a API a manda ("AAAAAAAAB9M="). */
export function versionOf(n: bigint | number): string {
  let value = BigInt(n);
  const bytes: number[] = [];
  for (let i = 0; i < BYTES; i++) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  return btoa(String.fromCharCode(...bytes));
}
