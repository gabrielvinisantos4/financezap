import Link from "next/link";
import { formatBRL } from "@/server/finance/money";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 ${className}`} aria-label="FinanceZap, página inicial">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="8" fill="#1b2a4a" />
        <path d="M8 18.5c0-3 2.4-4 5.2-4.6 2.3-.5 3.4-1 3.4-2.3 0-1.1-1-1.9-2.6-1.9-1.7 0-2.8.8-3 2.1" stroke="#e2a336" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M14 7v2.2M14 18.8V21M8 18.5c.4 1.4 1.9 2.3 4 2.3 2.6 0 4.6-1 4.6-3" stroke="#e2a336" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </svg>
      <span className="wide text-lg tracking-tight">FinanceZap</span>
    </Link>
  );
}

export function Money({ cents, sign = false, className = "" }: { cents: number; sign?: boolean; className?: string }) {
  const color = sign ? (cents > 0 ? "text-gain" : cents < 0 ? "text-loss" : "") : "";
  const prefix = sign && cents > 0 ? "+" : "";
  return <span className={`money ${color} ${className}`}>{prefix}{formatBRL(cents)}</span>;
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="wide text-2xl sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-ink-soft">{description}</p>}
      </div>
      {children}
    </header>
  );
}

export function Panel({ title, children, className = "", action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="wide text-base">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "gain" | "loss" | "coin"; children: React.ReactNode }) {
  const tones = { neutral: "bg-paper text-ink-soft", gain: "bg-gain-soft text-gain", loss: "bg-loss-soft text-loss", coin: "bg-coin-soft text-ink" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
