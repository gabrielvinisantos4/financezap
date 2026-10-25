import { formatInTimeZone } from "date-fns-tz";

/** Datas de calendário são strings ISO "YYYY-MM-DD" (sem fuso), coerentes com a coluna `date`. */
export type ISODate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: string): boolean {
  if (!ISO_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "Hoje" no fuso do usuário (padrão America/Sao_Paulo). */
export function todayIn(tz: string, now: Date = new Date()): ISODate {
  return formatInTimeZone(now, tz, "yyyy-MM-dd");
}

function parts(d: ISODate) {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function make(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(d: ISODate, n: number): ISODate {
  const { y, m, day } = parts(d);
  const dt = new Date(Date.UTC(y, m - 1, day + n));
  return make(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Soma meses mantendo o dia, limitado ao último dia do mês (31/01 + 1 mês = 28/02). */
export function addMonths(d: ISODate, n: number, preferredDay?: number): ISODate {
  const { y, m, day } = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const target = preferredDay ?? day;
  return make(ny, nm, Math.min(target, daysInMonth(ny, nm)));
}

export function startOfMonth(d: ISODate): ISODate {
  const { y, m } = parts(d);
  return make(y, m, 1);
}

export function endOfMonth(d: ISODate): ISODate {
  const { y, m } = parts(d);
  return make(y, m, daysInMonth(y, m));
}

/** Semana de segunda a domingo. */
export function startOfWeek(d: ISODate): ISODate {
  const { y, m, day } = parts(d);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0=domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(d, diff);
}

export function formatBR(d: ISODate): string {
  const { y, m, day } = parts(d);
  return `${pad(day)}/${pad(m)}/${y}`;
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function monthName(m: number): string {
  return MONTHS[m - 1];
}

export function monthLabel(d: ISODate): string {
  const { y, m } = parts(d);
  return `${monthName(m)}/${y}`;
}

export type Period = { from: ISODate; to: ISODate; label: string };

export type PeriodSpec =
  | { type: "today" }
  | { type: "yesterday" }
  | { type: "this_week" }
  | { type: "last_week" }
  | { type: "this_month" }
  | { type: "last_month" }
  | { type: "month"; month: number; year?: number | null }
  | { type: "this_year" }
  | { type: "last_n_days"; days: number }
  | { type: "custom"; from: ISODate; to: ISODate };

/** Resolve um período relativo usando a data de hoje do usuário. */
export function resolvePeriod(spec: PeriodSpec, today: ISODate): Period {
  const { y, m } = parts(today);
  switch (spec.type) {
    case "today":
      return { from: today, to: today, label: "hoje" };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d, label: "ontem" };
    }
    case "this_week":
      return { from: startOfWeek(today), to: today, label: "nesta semana" };
    case "last_week": {
      const start = addDays(startOfWeek(today), -7);
      return { from: start, to: addDays(start, 6), label: "na semana passada" };
    }
    case "this_month":
      return { from: startOfMonth(today), to: endOfMonth(today), label: `em ${monthName(m)}` };
    case "last_month": {
      const d = addMonths(startOfMonth(today), -1);
      return { from: d, to: endOfMonth(d), label: `em ${monthName(parts(d).m)}` };
    }
    case "month": {
      if (spec.month < 1 || spec.month > 12) throw new Error("Mês inválido");
      // Sem ano explícito: o mês mais recente que não está no futuro
      const year = spec.year ?? (spec.month > m ? y - 1 : y);
      const d = make(year, spec.month, 1);
      const label = year === y ? `em ${monthName(spec.month)}` : `em ${monthName(spec.month)}/${year}`;
      return { from: d, to: endOfMonth(d), label };
    }
    case "this_year":
      return { from: make(y, 1, 1), to: make(y, 12, 31), label: `em ${y}` };
    case "last_n_days": {
      const n = Math.max(1, Math.min(366, Math.floor(spec.days)));
      return { from: addDays(today, -(n - 1)), to: today, label: `nos últimos ${n} dias` };
    }
    case "custom":
      if (!isISODate(spec.from) || !isISODate(spec.to) || spec.from > spec.to) throw new Error("Período inválido");
      return { from: spec.from, to: spec.to, label: `de ${formatBR(spec.from)} a ${formatBR(spec.to)}` };
  }
}
