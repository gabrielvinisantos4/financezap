"use client";

import { useEffect, useRef, useState } from "react";
import { interpretByRules } from "@/server/agent/fallback";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/server/finance/categories";

/**
 * iPhone com a conversa real do FinanceZap no WhatsApp.
 * As cenas mostram os jeitos de registrar; no modo interativo o visitante escreve um gasto
 * e recebe a resposta montada pelas mesmas regras do robô (sem IA, sem servidor).
 */

type Bubble =
  | { from: "me" | "bot"; text: string; time: string }
  | { from: "me"; kind: "audio"; seconds: number; time: string }
  | { from: "me"; kind: "receipt"; time: string };

export type Scene = "escrever" | "falar" | "encaminhar";

const SCENES: Record<Scene, Bubble[]> = {
  escrever: [
    { from: "me", text: "Gastei R$ 50 no posto", time: "10:20" },
    { from: "bot", text: "✅ Despesa registrada!\n⛽ Combustível\nR$ 50,00", time: "10:20" },
    { from: "me", text: "Quanto gastei este mês?", time: "10:23" },
    { from: "bot", text: "📊 Você gastou\nR$ 2.031,55 este mês.", time: "10:23" },
  ],
  falar: [
    { from: "me", kind: "audio", seconds: 4, time: "12:31" },
    { from: "bot", text: "🎙️ “gastei 35 na farmácia”\n\n✅ Despesa registrada!\n💊 Farmácia\nR$ 35,00", time: "12:31" },
  ],
  encaminhar: [
    { from: "me", kind: "receipt", time: "19:05" },
    { from: "bot", text: "🧾 Li o comprovante.\n\n✅ Despesa registrada!\n🛒 Mercado\nR$ 89,90", time: "19:05" },
  ],
};

const ALL_CATS = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES];
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nowTime = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** A mesma leitura que o robô faz sem IA, no formato da resposta dele. */
export function previewReply(text: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const it = interpretByRules(text, { today });
  if (it.intent === "record" && it.entries.length) {
    const e = it.entries[0];
    if (e.amount === null) return e.kind === "expense" ? `Qual foi o valor de “${e.description}”?` : "Qual foi o valor recebido?";
    const cat = ALL_CATS.find((c) => c.slug === e.category);
    const lines = [e.kind === "expense" ? "✅ Despesa registrada!" : "✅ Receita registrada!"];
    if (cat) lines.push(`${cat.icon} ${cat.name}`);
    lines.push(`${brl(e.amount)}${e.installments ? ` em ${e.installments}x` : ""}`);
    return lines.join("\n");
  }
  if (it.intent === "budget" && it.budget?.action === "set" && it.budget.amount) {
    const cat = DEFAULT_EXPENSE_CATEGORIES.find((c) => c.slug === it.budget!.category);
    return `🎯 Limite definido!\n${cat ? `${cat.icon} ${cat.name}` : "📊 Total do mês"}: ${brl(it.budget.amount)}\nAviso em 80% e em 100%.`;
  }
  if (it.intent === "fixed" && it.fixed?.action === "set" && it.fixed.amount && it.fixed.day) {
    return `🔁 Conta fixa cadastrada!\n${it.fixed.description ?? "Conta fixa"} · ${brl(it.fixed.amount)}\nLembro você todo dia ${it.fixed.day}.`;
  }
  if (it.intent === "query") return "📊 No seu WhatsApp eu respondo com os seus números de verdade.";
  return "Aqui na demonstração eu entendo lançamentos. Tente: “paguei 120 de luz”.";
}

function Wave() {
  const bars = [6, 10, 14, 9, 16, 12, 18, 13, 8, 15, 19, 11, 8, 14, 10, 16, 7, 12, 9, 6];
  return (
    <span className="ph-wave" aria-hidden="true">
      {bars.map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </span>
  );
}

function BubbleView({ b }: { b: Bubble }) {
  const mine = b.from === "me";
  return (
    <li className={`ph-row ${mine ? "is-me" : "is-bot"}`}>
      <div className="ph-bubble">
        {"kind" in b && b.kind === "audio" ? (
          <span className="ph-audio">
            <span className="ph-play" aria-hidden="true" />
            <Wave />
            <span className="ph-dur">0:0{b.seconds}</span>
          </span>
        ) : "kind" in b && b.kind === "receipt" ? (
          <span className="ph-pix" aria-label="Comprovante de Pix de R$ 89,90 para Mercado Bom Preço">
            <b>Comprovante Pix</b>
            <strong>R$ 89,90</strong>
            <span>Mercado Bom Preço</span>
          </span>
        ) : (
          <span className="ph-text">{"text" in b ? b.text : ""}</span>
        )}
        <span className="ph-time">{b.time}</span>
      </div>
    </li>
  );
}

export function Phone({ scene = "escrever", interactive = false, size = "lg" }: { scene?: Scene; interactive?: boolean; size?: "lg" | "md" }) {
  const [live, setLive] = useState<{ me: string; bot: string | null; time: string } | null>(null);
  const [draft, setDraft] = useState("");
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim().slice(0, 160);
    if (!text) return;
    const time = nowTime();
    setLive({ me: text, bot: null, time });
    setDraft("");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLive({ me: text, bot: previewReply(text), time }), 900);
  }

  const bubbles: Bubble[] = live
    ? [{ from: "me", text: live.me, time: live.time }, ...(live.bot ? [{ from: "bot" as const, text: live.bot, time: live.time }] : [])]
    : SCENES[scene];

  return (
    <div className={`ph ph-${size}`} data-ui>
      <div className="ph-screen">
        <div className="ph-status" aria-hidden="true">
          <span>10:24</span>
          <span className="ph-island" />
          <span className="ph-icons">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="ph-head">
          <span className="ph-back" aria-hidden="true" />
          <span className="ph-avatar" aria-hidden="true">
            <LogoBars />
          </span>
          <span>
            <strong>FinanceZap</strong>
            <small>{live && !live.bot ? "digitando…" : "online"}</small>
          </span>
        </div>
        <ol key={live ? `live-${live.time}-${live.me}` : scene} className="ph-chat" aria-live="polite" aria-label="Conversa de exemplo com o FinanceZap">
          {bubbles.map((b, i) => (
            <BubbleView key={i} b={b} />
          ))}
          {live && !live.bot && (
            <li className="ph-row is-bot">
              <div className="ph-bubble ph-typing" aria-label="digitando">
                <i />
                <i />
                <i />
              </div>
            </li>
          )}
        </ol>
        {interactive ? (
          <form className="ph-composer" onSubmit={send}>
            <label className="sr-only" htmlFor={`ph-try-${size}`}>
              Experimente: escreva um gasto
            </label>
            <input
              id={`ph-try-${size}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Experimente: paguei 120 de luz"
              autoComplete="off"
              maxLength={160}
            />
            <button type="submit" aria-label="Enviar mensagem de teste">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" fill="currentColor" />
              </svg>
            </button>
          </form>
        ) : (
          <div className="ph-composer" aria-hidden="true">
            <span className="ph-fake">Mensagem</span>
            <span className="ph-mic" />
          </div>
        )}
      </div>
    </div>
  );
}

export function LogoBars({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect x="2" y="9" width="3" height="5" rx="1.2" fill="currentColor" />
      <rect x="6.5" y="6" width="3" height="8" rx="1.2" fill="currentColor" />
      <rect x="11" y="2.5" width="3" height="11.5" rx="1.2" fill="currentColor" />
    </svg>
  );
}
