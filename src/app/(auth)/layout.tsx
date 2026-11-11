import { Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr] lg:p-3">
      <div className="flex flex-col px-4 py-5 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle className="theme-btn" />
        </div>
        <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-10">
          <div className="card p-6 sm:p-9">{children}</div>
        </main>
      </div>

      <aside
        className="relative hidden overflow-hidden rounded-[32px] p-12 text-white lg:flex lg:flex-col lg:justify-between"
        style={{
          background:
            "radial-gradient(640px 360px at 70% -10%, rgba(34,197,94,.35), transparent 70%), radial-gradient(520px 300px at 0% 110%, rgba(34,197,94,.16), transparent 70%), #0c1612",
        }}
        aria-hidden="true"
      >
        <p className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm text-white/80 ring-1 ring-white/10">
          Seu assistente financeiro no WhatsApp
        </p>

        <div className="mx-auto grid w-full max-w-md gap-3">
          <div className="ml-auto max-w-[80%] rounded-[20px] rounded-tr-md bg-[#005c4b] px-4 py-3 text-[0.95rem] shadow-lg">Quanto gastei com combustível em outubro?</div>
          <div className="max-w-[85%] rounded-[20px] rounded-tl-md bg-white/10 px-4 py-3 text-[0.95rem] leading-relaxed ring-1 ring-white/10 backdrop-blur">
            Em outubro você gastou <b className="text-[#4ade80]">R$ 412,30</b> com combustível, em 7 abastecimentos. É 12% a menos que em setembro.
          </div>
          <div className="ml-auto max-w-[80%] rounded-[20px] rounded-tr-md bg-[#005c4b] px-4 py-3 text-[0.95rem] shadow-lg">Gastei 50 no posto</div>
          <div className="max-w-[85%] rounded-[20px] rounded-tl-md bg-white/10 px-4 py-3 text-[0.95rem] leading-relaxed ring-1 ring-white/10 backdrop-blur">
            Despesa registrada: Combustível, <b className="text-[#4ade80]">R$ 50,00</b>.
          </div>
        </div>

        <div>
          <p className="max-w-xl text-[2.4rem] font-bold leading-[1.05] tracking-[-0.045em]">
            Pergunte do seu jeito. <span className="text-[#4ade80]">A conta fecha.</span>
          </p>
          <p className="mt-4 max-w-sm text-white/65">As respostas vêm calculadas a partir dos seus lançamentos, direto no banco de dados.</p>
        </div>
      </aside>
    </div>
  );
}
