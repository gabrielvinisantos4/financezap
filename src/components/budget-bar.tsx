/** Barra de progresso de um limite: verde até 80%, âmbar até 100%, vermelho acima. */
export function BudgetBar({ pct }: { pct: number }) {
  const tone = pct >= 100 ? "bg-loss" : pct >= 80 ? "bg-coin" : "bg-gain";
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={Math.min(pct, 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% do limite usado`}>
      <div className={`h-full rounded-full ${tone} transition-[width]`} style={{ width: `${Math.min(pct, 100)}%` }} />
      <span className="absolute inset-y-0 left-[80%] w-px bg-ink/30" aria-hidden />
    </div>
  );
}
