import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <Logo />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</main>
      </div>
      <aside className="hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-end" aria-hidden="true">
        <p className="display max-w-md text-5xl">“Quanto gastei com combustível em outubro?”</p>
        <p className="mt-6 max-w-sm text-white/70">Pergunte em português, do seu jeito. A resposta vem calculada a partir dos seus lançamentos.</p>
      </aside>
    </div>
  );
}
