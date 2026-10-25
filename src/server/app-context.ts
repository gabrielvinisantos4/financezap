import "server-only";
import { requireUser } from "./auth/session";
import { todayIn, resolvePeriod, type PeriodSpec } from "./finance/dates";

/** Contexto padrão de páginas do cliente: usuário logado + "hoje" no fuso dele. */
export async function appContext() {
  const user = await requireUser();
  const today = todayIn(user.timezone);
  return { user, today };
}

/** Lê ?mes=AAAA-MM da URL (padrão: mês atual). */
export function monthFromParam(param: string | undefined, today: string) {
  const spec: PeriodSpec = param && /^\d{4}-\d{2}$/.test(param) ? { type: "month", month: Number(param.slice(5)), year: Number(param.slice(0, 4)) } : { type: "this_month" };
  try {
    return { ...resolvePeriod(spec, today), key: param && /^\d{4}-\d{2}$/.test(param) ? param : today.slice(0, 7) };
  } catch {
    return { ...resolvePeriod({ type: "this_month" }, today), key: today.slice(0, 7) };
  }
}
