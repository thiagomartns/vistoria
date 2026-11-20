"use client";

import { Input } from "@sanjou/ui/input";
import {
  type ChangeEvent,
  type ComponentProps,
  type Ref,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// Um Input do Sanjou que mascara o que a pessoa digita ou cola (ADR 0063). A máscara vem de quem usa, e o valor que
// sai pelo `onChange` já é o mascarado: o schema do formulário tira a máscara ao salvar. O cursor fica onde a pessoa
// estava, contado em caracteres que a máscara mantém (letras e dígitos do trecho antes dele, já mascarado), não em
// posição, porque a máscara põe e tira separadores em volta dele. Candidato ao Sanjou: nada aqui é do vistoria.

const SIGNIFICANT = /[0-9A-Za-z]/;

/** Quantos caracteres que importam (letras e dígitos) o texto tem. */
export function significantCount(value: string): number {
  let count = 0;
  for (const char of value) if (SIGNIFICANT.test(char)) count++;
  return count;
}

/** A posição logo depois do `count`-ésimo caractere que importa de `masked` (0 antes do primeiro). */
export function caretAfter(masked: string, count: number): number {
  if (count === 0) return 0;
  let seen = 0;
  for (let index = 0; index < masked.length; index++) {
    if (SIGNIFICANT.test(masked[index]!) && ++seen === count) return index + 1;
  }
  return masked.length;
}

type MaskedInputProps = Omit<ComponentProps<typeof Input>, "onChange" | "value"> & {
  /** Do texto como está no campo para o texto mascarado. */
  mask: (raw: string) => string;
  value: string;
  /** Recebe o texto já mascarado (o `field.onChange` do react-hook-form). */
  onChange: (masked: string) => void;
  ref?: Ref<HTMLInputElement>;
};

export function MaskedInput({ mask, value, onChange, ref, ...props }: MaskedInputProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  // Força o render mesmo quando a máscara devolve o mesmo valor (uma letra num campo só de dígitos): o React volta o
  // input ao valor controlado, e o cursor precisa ser recolocado depois disso.
  const [, rendered] = useState(0);

  useLayoutEffect(() => {
    const element = input.current;
    if (caret.current === null || !element) return;
    if (element.ownerDocument.activeElement === element)
      element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const masked = mask(raw);
    // O trecho antes do cursor passa pela mesma máscara: o que ela recusa (uma letra num campo de dígitos) não conta, e
    // colar no fim, com o +55 que a máscara tira, deixa o cursor no fim.
    const before = raw.slice(0, event.target.selectionStart ?? raw.length);
    caret.current = caretAfter(masked, significantCount(mask(before)));
    onChange(masked);
    rendered((count) => count + 1);
  }

  return (
    <Input
      {...props}
      ref={(element) => {
        input.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      value={value}
      onChange={handleChange}
    />
  );
}
