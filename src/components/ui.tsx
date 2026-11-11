import Link from "next/link";
import { formatBRL } from "@/server/finance/money";
import { Icon, type IconName } from "@/components/icons";

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[9px] text-white shadow-[0_6px_14px_-6px_rgba(22,163,74,0.7)]"
      style={{ width: size, height: size, background: "linear-gradient(160deg,#22c55e,#15803d)" }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" width={size * 0.48} height={size * 0.48}>
        <rect x="2" y="9" width="3" height="5" rx="1.2" fill="currentColor" />
        <rect x="6.5" y="6" width="3" height="8" rx="1.2" fill="currentColor" />
        <rect x="11" y="2.5" width="3" height="11.5" rx="1.2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({ className = "", href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 ${className}`} aria-label="FinanceZap, página inicial">
      <LogoMark />
      <span className="text-[1.1rem] font-bold tracking-[-0.03em]">FinanceZap</span>
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
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-[-0.035em] sm:text-[2.1rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-prose text-ink-soft">{description}</p>}
      </div>
      {children}
    </header>
  );
}

export function Panel({ title, children, className = "", action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`card min-w-0 p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-5 flex items-center justify-between gap-2">
          {title && <h2 className="text-[1.02rem] font-semibold tracking-[-0.02em]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-8 items-center rounded-full bg-paper px-3.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-gain-soft hover:text-gain">
      {children}
    </Link>
  );
}

export function Stat({ icon, label, hint, children, tone }: { icon: IconName; label: string; hint?: string; children: React.ReactNode; tone?: "gain" | "loss" | "coin" }) {
  const tones = { gain: "bg-gain-soft text-gain", loss: "bg-loss-soft text-loss", coin: "bg-coin-soft text-coin" };
  return (
    <div className="card flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-3.5 sm:p-5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] sm:h-11 sm:w-11 sm:rounded-[14px] ${tone ? tones[tone] : "bg-gain-soft text-gain"}`}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.8rem] font-medium text-ink-faint">{label}</p>
        <p className="money whitespace-nowrap text-[1.12rem] font-bold tracking-[-0.03em] sm:text-[1.3rem]">{children}</p>
        {hint && <p className="text-[0.72rem] font-medium text-ink-faint">{hint}</p>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[22px] bg-paper px-5 py-9 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "gain" | "loss" | "coin"; children: React.ReactNode }) {
  const tones = { neutral: "bg-paper text-ink-soft", gain: "bg-gain-soft text-gain", loss: "bg-loss-soft text-loss", coin: "bg-coin-soft text-coin" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Notice({ children, tone = "coin" }: { children: React.ReactNode; tone?: "coin" | "gain" }) {
  return (
    <div role="status" className={`glass flex items-start gap-3 rounded-[20px] px-4 py-3.5 text-sm ${tone === "gain" ? "text-gain" : ""}`}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${tone === "gain" ? "bg-gain-soft text-gain" : "bg-coin-soft text-coin"}`}>
        <Icon name={tone === "gain" ? "shield" : "calendar"} size={16} />
      </span>
      <div className="self-center">{children}</div>
    </div>
  );
}
