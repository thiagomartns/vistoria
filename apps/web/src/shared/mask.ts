// As máscaras dos campos de texto (ADR 0063): o banco e o contrato guardam o valor sem máscara, e a UI a põe ao
// digitar e ao mostrar. Funções puras, sem React: os schemas de cada feature montam a máscara do campo sobre elas.

/**
 * Preenche o padrão com os caracteres, um por `0` do padrão, até eles acabarem: `fillPattern("7199", "(00) 0000-0000")`
 * dá `(71) 99`. O separador só entra antes de um caractere, então apagar o último nunca deixa um separador sobrando.
 */
export function fillPattern(chars: string, pattern: string): string {
  let out = "";
  let next = 0;
  for (const slot of pattern) {
    if (next >= chars.length) break;
    if (slot === "0") out += chars[next++];
    else out += slot;
  }
  return out;
}

/** Só os dígitos. */
export const digitsOf = (value: string) => value.replace(/\D/g, "");
