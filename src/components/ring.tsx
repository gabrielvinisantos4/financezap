/** Anel de progresso (limites). */
export function Ring({ pct, size = 64, stroke = 6, color = "var(--green, var(--color-gain))" }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="fz-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track, var(--color-line))" strokeWidth={stroke} />
      <circle
        className="fz-ring-val"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(Math.min(pct, 100) / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ ["--len" as string]: `${c}` }}
      />
    </svg>
  );
}

