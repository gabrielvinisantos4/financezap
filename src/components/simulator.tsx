"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { simulateMessage } from "@/app/actions/simulator";

type Msg = { id: number; from: "me" | "bot"; text: string; buttons?: { id: string; title: string }[]; time: string };

const SUGGESTIONS = [
  "Gastei 50 reais no posto",
  "Recebi 1.200 de um cliente de marketing",
  "Comprei 85 no mercado ontem",
  "Quanto gastei este mês?",
  "Quanto tenho disponível?",
  "Errei o valor, era 70",
  "Apaga o último gasto",
  "Mostra meus últimos 10 lançamentos",
];

const now = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function Simulator() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const used = useRef(new Set<string>());

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, pending]);

  function push(m: Omit<Msg, "id" | "time">) {
    setMsgs((prev) => [...prev, { ...m, id: ++seq.current, time: now() }]);
  }

  function send(payload: { text?: string; buttonId?: string }, shown: string) {
    if (pending) return;
    push({ from: "me", text: shown });
    start(async () => {
      try {
        const r = await simulateMessage(payload);
        push({ from: "bot", text: r.text, buttons: r.buttons });
      } catch {
        push({ from: "bot", text: "Não consegui falar com o servidor. Tente de novo." });
      }
    });
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-13rem)] min-h-[480px] max-w-2xl flex-col overflow-hidden card rounded-[28px] bg-[#efeae2] dark:bg-[#0b141a] lg:h-[calc(100dvh-10rem)]">
      <div className="flex items-center gap-3 bg-night px-4 py-3 text-white">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gain font-bold text-white" aria-hidden="true">F</span>
        <div className="leading-tight">
          <p className="font-semibold">FinanceZap</p>
          <p className="text-xs text-white/70">{pending ? "digitando…" : "simulador do WhatsApp"}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="mx-auto max-w-sm rounded-[16px] bg-surface/80 p-4 text-center text-sm text-ink-soft">
            Escreva como escreveria no WhatsApp. Tudo o que você registrar aqui aparece no painel na hora.
          </div>
        )}
        <ol className="grid gap-2">
          {msgs.map((m) => (
            <li key={m.id} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-[0.95rem] leading-snug ${m.from === "me" ? "rounded-br-md bg-gain text-white" : "rounded-bl-md bg-surface text-ink"}`}>
                {m.text}
                <span className={`mt-1 block text-right text-[0.68rem] ${m.from === "me" ? "text-white/60" : "text-ink-faint"}`}>{m.time}</span>
                {m.buttons && m.buttons.length > 0 && (
                  <span className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(m.buttons.length, 3)}, minmax(0, 1fr))` }}>
                    {m.buttons.map((b) => {
                      const disabled = used.current.has(b.id) || pending;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            m.buttons!.forEach((x) => used.current.add(x.id));
                            send({ buttonId: b.id }, b.title);
                          }}
                          className="rounded-lg border border-line py-1.5 text-center text-sm font-semibold text-ink hover:bg-paper disabled:opacity-50"
                        >
                          {b.title}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div ref={end} />
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 pb-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => send({ text: s }, s)} className="lg-btn shrink-0 rounded-full px-3 py-1.5 text-sm disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2 bg-[#e9ecf1] px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setText("");
          send({ text: t }, t);
        }}
      >
        <label htmlFor="sim-input" className="sr-only">Mensagem</label>
        <input id="sim-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensagem" autoComplete="off" maxLength={1000} className="input flex-1 rounded-full" />
        <button className="btn btn-primary px-5" disabled={pending || !text.trim()}>Enviar</button>
      </form>
    </div>
  );
}
