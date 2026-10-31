// O relógio do app, injetável como o `TimeProvider` da API: quem decide por prazo (a janela offline) lê `clock.now()`,
// e os testes trocam `clock.now` em vez de mexer no relógio do processo.

export const clock = {
  now: (): Date => new Date(),
};
