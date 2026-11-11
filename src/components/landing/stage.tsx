"use client";

import { useEffect, useRef, useState } from "react";
import { interpretByRules } from "@/server/agent/fallback";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/server/finance/categories";

/**
 * O palco fixo da página: a conversa real com o FinanceZap no WhatsApp.
 * Cada seção da coluna de leitura escolhe a cena (data-scene); a troca é um crossfade lento.
 * O visitante pode escrever um gasto no campo de mensagem e ver a resposta, montada pelas
 * mesmas regras de interpretação do robô (sem IA, sem servidor).
 */

type Bubble =
  | { from: "me" | "bot"; text: string; time: string }
  | { from: "me"; kind: "audio"; seconds: number; time: string }
  | { from: "me"; kind: "receipt"; time: string };

export type SceneId = "escrever" | "falar" | "encaminhar" | "vincular" | "live";

const SCENES: Record<Exclude<SceneId, "live">, Bubble[]> = {
  escrever: [
    { from: "me", text: "Gastei 50 no posto", time: "08:12" },
    { from: "bot", text: "✅ Despesa registrada!\n\n⛽ Combustível\n📍 Posto\n💰 R$ 50,00\n📅 Data: 11/11/2026\n\nSeu lançamento foi salvo com sucesso.", time: "08:12" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
    { from: "me", text: "Quanto gastei esse mês?", time: "18:40" },
    { from: "bot", text: "📊 Resumo de novembro\n\n🟢 Entradas: R$ 4.500,00\n🔴 Saídas: R$ 2.031,55\n✅ Resultado: R$ 2.468,45", time: "18:40" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  ],
  falar: [
    { from: "me", kind: "audio", seconds: 4, time: "12:31" },
    { from: "bot", text: "🎙️ “gastei 35 reais na farmácia”\n\n✅ Despesa registrada!\n\n💊 Farmácia\n💰 R$ 35,00\n📅 Data: 11/11/2026", time: "12:31" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  ],
  encaminhar: [
    { from: "me", kind: "receipt", time: "19:05" },
    { from: "bot", text: "🧾 Li o comprovante.\n\n✅ Despesa registrada!\n\n🛒 Mercado\n📍 Mercado Bom Preço\n💰 R$ 89,90\n📅 Data: 10/11/2026", time: "19:05" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  ],
  vincular: [
    { from: "me", text: "Vincular 482913", time: "09:02" },
    { from: "bot", text: "✅ Pronto, Maria! Seu WhatsApp foi vinculado ao FinanceZap.\n\nAgora é só me contar seus gastos e recebimentos, do seu jeito. Por exemplo:\n• “Gastei 50 no posto”\n• “Recebi 1.200 de um cliente”\n• “Quanto gastei este mês?”", time: "09:02" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  ],
};

const READ_TICKS = " ✓✓"; // taste-skill-ignore — o "lido" do próprio WhatsApp
const ALL_CATS = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES];
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nowTime = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** A mesma leitura que o robô faz sem IA, formatada como a resposta dele. */
export function previewReply(text: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const it = interpretByRules(text, { today });
  if (it.intent === "record" && it.entries.length) {
    const e = it.entries[0];
    if (e.amount === null) return e.kind === "expense" ? `Qual foi o valor de “${e.description}”?` : "Qual foi o valor recebido?";
    const cat = ALL_CATS.find((c) => c.slug === e.category);
    const lines = [e.kind === "expense" ? "✅ Despesa registrada!" : "✅ Receita registrada!", ""]; // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
    if (cat) lines.push(`${cat.icon} ${cat.name}`);
    if (e.merchant) lines.push(`📍 ${e.merchant}`); // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
    if (e.counterparty) lines.push(`👤 ${e.counterparty}`); // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
    lines.push(`💰 ${brl(e.amount)}${e.installments ? ` em ${e.installments}x` : ""}`); // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
    const d = e.date ?? today;
    lines.push(`📅 Data: ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`); // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
    lines.push("", "Seu lançamento foi salvo com sucesso.");
    return lines.join("\n");
  }
  if (it.intent === "budget" && it.budget?.action === "set" && it.budget.amount) {
    const cat = DEFAULT_EXPENSE_CATEGORIES.find((c) => c.slug === it.budget!.category);
    return `🎯 Limite definido!\n\n${cat ? `${cat.icon} ${cat.name}` : "📊 Total do mês"}: ${brl(it.budget.amount)} por mês\n\nEu aviso quando chegar em 80% e em 100%.`; // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  }
  if (it.intent === "fixed" && it.fixed?.action === "set" && it.fixed.amount && it.fixed.day) {
    return `🔁 Conta fixa cadastrada!\n\n${it.fixed.description ?? "Conta fixa"}\n💰 ${brl(it.fixed.amount)} por mês\n📅 Todo dia ${it.fixed.day}\n\nEu lembro você no dia do vencimento.`; // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  }
  if (it.intent === "query") return "📊 No WhatsApp de verdade eu respondo com os seus números, calculados direto do seu histórico."; // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  return "Aqui na demonstração eu entendo lançamentos. Tente: “paguei 120 de luz” ou “recebi 800 de um cliente”.";
}

function Waveform() {
  const bars = [6, 10, 14, 9, 18, 12, 20, 15, 8, 16, 22, 13, 9, 17, 11, 19, 7, 14, 10, 6, 12, 16, 9, 5];
  return (
    <span className="lp-wave" aria-hidden="true">
      {bars.map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </span>
  );
}

function PixReceipt() {
  return (
    <span className="lp-pix" aria-label="Comprovante de Pix de R$ 89,90 para Mercado Bom Preço">
      <b>Comprovante de Pix</b>
      <span className="lp-pix-value">R$ 89,90</span>
      <span>
        Para <strong>Mercado Bom Preço</strong>
      </span>
      <span>10 nov 2026 · 18:57</span>
      <span>Pago por Maria S.</span>
    </span>
  );
}

function BubbleView({ b }: { b: Bubble }) {
  const mine = b.from === "me";
  return (
    <li className={`lp-row ${mine ? "is-me" : "is-bot"}`}>
      <div className="lp-bubble">
        {"kind" in b && b.kind === "audio" ? (
          <span className="lp-audio">
            <span className="lp-play" aria-hidden="true" />
            <Waveform />
            <span className="lp-dur">0:0{b.seconds}</span>
          </span>
        ) : "kind" in b && b.kind === "receipt" ? (
          <PixReceipt />
        ) : (
          <span className="lp-text">{"text" in b ? b.text : ""}</span>
        )}
        <span className="lp-time">
          {b.time}
          {mine ? READ_TICKS : ""}
        </span>
      </div>
    </li>
  );
}

export function Stage() {
  const [scene, setScene] = useState<SceneId>("escrever");
  const [live, setLive] = useState<{ me: string; bot: string | null; time: string } | null>(null);
  const [draft, setDraft] = useState("");
  const timer = useRef<number | null>(null);

  // A seção visível na coluna de leitura escolhe a cena
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]"));
    if (!els.length || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const next = (visible.target as HTMLElement).dataset.scene as SceneId;
        setScene((cur) => (cur === "live" && next === "escrever" ? cur : next));
      },
      { rootMargin: "-35% 0px -45% 0px", threshold: [0, 0.25, 0.5] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim().slice(0, 160);
    if (!text) return;
    const time = nowTime();
    setLive({ me: text, bot: null, time });
    setScene("live");
    setDraft("");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLive({ me: text, bot: previewReply(text), time }), 900);
  }

  const scenes: [SceneId, Bubble[]][] = [
    ...(Object.entries(SCENES) as [SceneId, Bubble[]][]),
    ["live", live ? [{ from: "me", text: live.me, time: live.time }, ...(live.bot ? [{ from: "bot" as const, text: live.bot, time: live.time }] : [])] : []],
  ];

  return (
    <div className="lp-stage" data-ui>
      <div className="lp-chat-head">
        <span className="lp-avatar" aria-hidden="true">
          F
        </span>
        <span>
          <strong>FinanceZap</strong>
          <span className="lp-sub">{live && !live.bot && scene === "live" ? "digitando…" : "conta comercial"}</span>
        </span>
      </div>

      <div className="lp-chat" aria-live="polite">
        {scenes.map(([id, bubbles]) => (
          <ol key={id} className={`lp-scene ${scene === id ? "is-on" : ""}`} aria-hidden={scene !== id} aria-label={`Conversa de exemplo: ${id}`}>
            {bubbles.map((b, i) => (
              <BubbleView key={`${id}-${i}`} b={b} />
            ))}
            {id === "live" && live && !live.bot && (
              <li className="lp-row is-bot">
                <div className="lp-bubble lp-typing" aria-label="digitando">
                  <i />
                  <i />
                  <i />
                </div>
              </li>
            )}
          </ol>
        ))}
      </div>

      <form className="lp-composer" onSubmit={send}>
        <label className="sr-only" htmlFor="lp-try">
          Experimente: escreva um gasto
        </label>
        <input
          id="lp-try"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Experimente: paguei 120 de luz"
          autoComplete="off"
          maxLength={160}
        />
        <button type="submit" aria-label="Enviar mensagem de teste">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" fill="currentColor" />
          </svg>
        </button>
      </form>

      <div className="lp-stage-bar">
        <span>WhatsApp oficial · (44) 99188-7438</span>
        <span>Responde em cerca de 3 s</span>
      </div>
    </div>
  );
}
