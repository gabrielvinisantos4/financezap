/**
 * Maquete do painel do FinanceZap, com números que fecham entre si:
 * entradas 6.500,00 − despesas 2.231,50 = saldo 4.268,50; as categorias somam as despesas.
 */
import { LogoBars } from "./phone";
import { Icon, type IconName } from "@/components/icons";
export { Icon };
import { Ring } from "@/components/ring";
export { Ring };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CATEGORIES = [
  { name: "Alimentação", value: 720, color: "#16a34a" },
  { name: "Transporte", value: 480, color: "#3b82f6" },
  { name: "Casa", value: 401.5, color: "#86d9a6" },
  { name: "Compras", value: 330, color: "#a78bfa" },
  { name: "Outros", value: 300, color: "#d4d8dd" },
];
const SPENT = CATEGORIES.reduce((s, c) => s + c.value, 0); // 2.231,50

export const LIMITS = [
  { name: "Alimentação", spent: 720, limit: 1000, icon: "fork" as const },
  { name: "Transporte", spent: 480, limit: 1000, icon: "car" as const },
  { name: "Compras", spent: 330, limit: 380, icon: "bag" as const },
];

const MONTHS = ["Jun", "Jul", "Ago", "Set", "Out", "Nov"];
const SALDO = [2100, 2640, 2480, 3180, 3605, 4268.5];

function LineChart() {
  const W = 560;
  const H = 200;
  const pad = { l: 52, r: 12, t: 12, b: 28 };
  const max = 5000;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (SALDO.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  // curva suave (Catmull-Rom → Bézier)
  const pts = SALDO.map((v, i) => [x(i), y(v)] as const);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const last = pts[pts.length - 1];
  const area = `${d} L${last[0]},${y(0)} L${pts[0][0]},${y(0)} Z`;
  return (
    <svg className="fz-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Saldo de junho a novembro, subindo de R$ 2.100 para R$ 4.268,50">
      <defs>
        <linearGradient id="fz-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#16a34a" stopOpacity="0.16" />
          <stop offset="1" stopColor="#16a34a" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1000, 2000, 3000, 4000, 5000].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--track)" strokeWidth="1" />
          <text x={pad.l - 10} y={y(v) + 4} textAnchor="end" className="fz-axis">
            {v === 0 ? "R$ 0" : `R$ ${(v / 1000).toFixed(0)} mil`}
          </text>
        </g>
      ))}
      {MONTHS.map((m, i) => (
        <text key={m} x={x(i)} y={H - 6} textAnchor="middle" className="fz-axis">
          {m}
        </text>
      ))}
      <path d={area} fill="url(#fz-area)" />
      <path className="fz-line-path" d={d} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" pathLength={1} />
      <circle cx={last[0]} cy={last[1]} r="5" fill="var(--green)" stroke="var(--card)" strokeWidth="2.5" />
    </svg>
  );
}

function Donut() {
  const size = 180;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = 3;
  let acc = 0;
  return (
    <div className="fz-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Gastos de novembro por categoria">
        {CATEGORIES.map((cat) => {
          const len = (cat.value / SPENT) * c;
          const el = (
            <circle
              key={cat.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={cat.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(len - gap, 0)} ${c}`}
              strokeDashoffset={-acc}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          acc += len;
          return el;
        })}
      </svg>
      <span className="fz-donut-center">
        <strong>{brl(SPENT)}</strong>
        <small>gastos do mês</small>
      </span>
    </div>
  );
}

const NAV: [IconName, string][] = [
  ["home", "Visão geral"],
  ["swap", "Movimentações"],
  ["tag", "Categorias"],
  ["gauge", "Limites"],
  ["calendar", "Contas fixas"],
  ["bars", "Relatórios"],
  ["gear", "Configurações"],
];

const STATS: { icon: IconName; label: string; value: string; tone?: "up" | "down" }[] = [
  { icon: "wallet", label: "Saldo do mês", value: brl(4268.5) },
  { icon: "up", label: "Entradas", value: brl(6500), tone: "up" },
  { icon: "down", label: "Despesas", value: brl(2231.5), tone: "down" },
  { icon: "piggy", label: "Economia", value: "66%" },
];

const MOVES: { icon: IconName; name: string; cat: string; when: string; value: number }[] = [
  { icon: "fuel", name: "Posto Shell", cat: "Combustível", when: "Hoje, 10:20", value: -50 },
  { icon: "cash", name: "Salário", cat: "Receita", when: "Ontem", value: 4500 },
  { icon: "cart", name: "Mercado Bom Preço", cat: "Mercado", when: "10 nov", value: -89.9 },
  { icon: "pill", name: "Farmácia", cat: "Saúde", when: "09 nov", value: -35 },
];

export function Dashboard() {
  return (
    <div className="fz-dash glass" data-ui aria-label="Painel do FinanceZap com saldo, gráficos, limites e movimentações">
      <aside className="fz-dash-side">
        <span className="fz-logo">
          <span className="fz-logo-mark">
            <LogoBars />
          </span>
          FinanceZap
        </span>
        <ul>
          {NAV.map(([ic, label], i) => (
            <li key={label} className={i === 0 ? "is-on" : ""}>
              <Icon name={ic} size={17} />
              {label}
            </li>
          ))}
        </ul>
        <span className="fz-dash-user">
          <span className="fz-avatar">M</span>
          <span>
            <strong>Maria Souza</strong>
            <small>Plano Pro</small>
          </span>
        </span>
      </aside>

      <div className="fz-dash-main">
        <header className="fz-dash-head">
          <span>
            <strong>Bom dia, Maria</strong>
            <small>Veja como estão suas finanças este mês.</small>
          </span>
          <span className="fz-chip">Novembro 2026</span>
        </header>

        <div className="fz-stats">
          {STATS.map((s) => (
            <div key={s.label} className="fz-stat">
              <span className={`fz-stat-icon ${s.tone ? `is-${s.tone}` : ""}`}>
                <Icon name={s.icon} />
              </span>
              <small>{s.label}</small>
              <strong>{s.value}</strong>
            </div>
          ))}
        </div>

        <div className="fz-dash-grid">
          <section className="fz-panel fz-panel-line">
            <header>
              <span>
                <strong>Evolução do saldo</strong>
                <small>Últimos 6 meses</small>
              </span>
              <span className="fz-delta">+18,4%</span>
            </header>
            <LineChart />
          </section>

          <section className="fz-panel fz-panel-donut">
            <header>
              <strong>Para onde vai seu dinheiro</strong>
            </header>
            <div className="fz-donut-row">
              <Donut />
              <ul className="fz-legend">
                {CATEGORIES.map((c) => (
                  <li key={c.name}>
                    <i style={{ background: c.color }} />
                    <span>{c.name}</span>
                    <b>{Math.round((c.value / SPENT) * 100)}%</b>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="fz-panel fz-panel-limits">
            <header>
              <strong>Limites</strong>
            </header>
            <ul className="fz-mini-limits">
              {LIMITS.map((l) => {
                const pct = Math.floor((l.spent * 100) / l.limit);
                return (
                  <li key={l.name}>
                    <span className="fz-ring-wrap">
                      <Ring pct={pct} size={84} stroke={7} color={pct >= 80 ? "#f59e0b" : "var(--green)"} />
                      <b>{pct}%</b>
                    </span>
                    <span className="fz-mini-name">{l.name}</span>
                    <small>
                      {brl(l.spent)} de {brl(l.limit)}
                    </small>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="fz-panel fz-panel-moves">
            <header>
              <strong>Últimas movimentações</strong>
            </header>
            <ul className="fz-moves">
              {MOVES.map((m) => (
                <li key={m.name}>
                  <span className={`fz-move-icon ${m.value > 0 ? "is-in" : ""}`}>
                    <Icon name={m.icon} size={17} />
                  </span>
                  <span className="fz-move-name">
                    <strong>{m.name}</strong>
                    <small>
                      {m.cat} · {m.when}
                    </small>
                  </span>
                  <b className={m.value > 0 ? "is-in" : ""}>
                    {m.value > 0 ? "+ " : "− "}
                    {brl(Math.abs(m.value))}
                  </b>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
