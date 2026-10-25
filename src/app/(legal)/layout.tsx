import { Logo } from "@/components/ui";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Logo />
      <article className="mt-10 grid gap-4 leading-relaxed [&_h1]:display [&_h1]:text-4xl [&_h2]:wide [&_h2]:mt-6 [&_h2]:text-xl [&_li]:ml-5 [&_li]:list-disc [&_p]:text-ink-soft [&_li]:text-ink-soft">
        <p className="rounded-xl bg-coin-soft px-4 py-3 text-sm !text-ink">
          Minuta para revisão jurídica. Antes do lançamento, este texto precisa ser revisado por um advogado e completado com os dados do controlador (razão social, CNPJ, endereço e contato do encarregado).
        </p>
        {children}
      </article>
    </div>
  );
}
