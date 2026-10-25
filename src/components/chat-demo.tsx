type Msg = { from: "me" | "bot"; text: string; time: string; buttons?: string[] };

const DEFAULT: Msg[] = [
  { from: "me", text: "Gastei 50 reais no posto", time: "08:12" },
  { from: "bot", text: "✅ Despesa registrada!\n\n⛽ Combustível\n💰 R$ 50,00\n📅 Data: hoje\n\nSeu lançamento foi salvo com sucesso.", time: "08:12" },
  { from: "me", text: "Recebi 1.200 de um cliente de marketing", time: "11:40" },
  { from: "bot", text: "✅ Receita registrada!\n\n📱 Marketing e social media\n💰 R$ 1.200,00", time: "11:40" },
  { from: "me", text: "Errei, o posto foi 70", time: "11:42" },
  { from: "bot", text: "Vou corrigir este lançamento:\nCombustível · R$ 50,00\n\n💰 Valor: R$ 50,00 → R$ 70,00\n\nConfirma?", time: "11:42", buttons: ["✅ Confirmar", "❌ Cancelar"] },
];

/** Transcrição estática de uma conversa real com o agente (sem dados de clientes). */
export function ChatDemo({ messages = DEFAULT, className = "" }: { messages?: Msg[]; className?: string }) {
  return (
    <figure className={`rounded-[28px] border border-line bg-[#e9ecf1] p-3 shadow-[0_30px_60px_-30px_rgb(27_42_74/0.45)] ${className}`} aria-label="Exemplo de conversa com o FinanceZap no WhatsApp">
      <div className="flex items-center gap-3 rounded-t-[20px] bg-ink px-4 py-3 text-white">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-coin font-bold text-ink" aria-hidden="true">F</span>
        <div className="leading-tight">
          <p className="font-semibold">FinanceZap</p>
          <p className="text-xs text-white/70">conta comercial</p>
        </div>
      </div>
      <ol className="grid gap-2 px-2 py-4">
        {messages.map((m, i) => (
          <li key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-[0.92rem] leading-snug ${m.from === "me" ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-white text-ink"}`}>
              {m.text}
              <span className={`mt-1 block text-right text-[0.68rem] ${m.from === "me" ? "text-white/60" : "text-ink-faint"}`}>{m.time}</span>
              {m.buttons && (
                <span className="mt-2 grid grid-cols-2 gap-1.5">
                  {m.buttons.map((b) => (
                    <span key={b} className="rounded-lg border border-line py-1.5 text-center text-sm font-semibold text-ink">
                      {b}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="sr-only">O cliente escreve gastos e recebimentos em linguagem natural e o assistente registra, categoriza e pede confirmação antes de corrigir.</figcaption>
    </figure>
  );
}
