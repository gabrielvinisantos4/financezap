/** Erro de regra de negócio com mensagem segura para mostrar ao cliente. */
export class FinanceError extends Error {
  constructor(
    public code:
      | "not_found"
      | "invalid"
      | "conflict"
      | "limit"
      | "forbidden",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "FinanceError";
  }
}
