import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getEntitlement } from "@/server/billing/entitlements";
import { getLinkedNumber } from "@/server/whatsapp/linking";
import { AppNav, type NavItem } from "@/components/app-nav";
import { Logo } from "@/components/ui";
import { logoutAction } from "@/app/actions/auth";
import { env } from "@/server/config/env";

const NAV: NavItem[] = [
  { href: "/app", label: "Visão geral", icon: "◎" },
  { href: "/app/lancamentos", label: "Lançamentos", icon: "≡" },
  { href: "/app/contas", label: "Contas", icon: "▭" },
  { href: "/app/relatorios", label: "Relatórios", icon: "▤" },
  { href: "/app/limites", label: "Limites", icon: "◔", mobile: false },
  { href: "/app/categorias", label: "Categorias", icon: "#", mobile: false },
  { href: "/app/whatsapp", label: "WhatsApp", icon: "✆", mobile: false },
  { href: "/app/assinatura", label: "Assinatura", icon: "★", mobile: false },
  { href: "/app/conta", label: "Conta", icon: "☺" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [ent, linked] = await Promise.all([getEntitlement(user.id), getLinkedNumber(user.id)]);
  const sim = env().SIMULATOR_ENABLED;
  const nav: NavItem[] = sim ? [NAV[0], { href: "/app/simulador", label: "Simulador", icon: "✉" }, ...NAV.slice(1)] : NAV;
  return (
    <div className="mx-auto grid min-h-dvh max-w-7xl lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-line px-4 py-6 lg:flex lg:flex-col">
        <Logo className="mb-8 px-3" />
        <AppNav items={nav} variant="desktop" />
        <div className="mt-auto px-3 pt-6 text-sm">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-ink-faint">{user.email}</p>
          <form action={logoutAction} className="mt-2">
            <button className="text-ink-soft underline-offset-2 hover:underline">Sair</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 pb-24 lg:pb-10">
        <div className="flex items-center justify-between px-4 py-4 lg:hidden">
          <Logo />
          <Link href="/app/whatsapp" className="text-sm font-semibold">WhatsApp</Link>
        </div>
        {!ent.active && (
          <div className="mx-4 mt-2 rounded-xl bg-coin-soft px-4 py-3 text-sm sm:mx-8 lg:mt-6" role="status">
            {ent.reason === "pending_payment"
              ? "Estamos aguardando a confirmação do pagamento. O WhatsApp é liberado assim que o Asaas confirmar."
              : ent.reason === "blocked"
                ? "Seu acesso está suspenso. Entre em contato com o suporte."
                : "Sua assinatura não está ativa, então o assistente no WhatsApp está pausado."}{" "}
            {ent.reason !== "blocked" && <Link href="/app/assinatura" className="font-semibold underline">Ver assinatura</Link>}
          </div>
        )}
        {ent.active && !linked && !sim && (
          <div className="mx-4 mt-2 rounded-xl bg-coin-soft px-4 py-3 text-sm sm:mx-8 lg:mt-6" role="status">
            Falta um passo: <Link href="/app/whatsapp" className="font-semibold underline">vincule seu WhatsApp</Link> para começar a registrar pela conversa.
          </div>
        )}
        <main className="px-4 py-6 sm:px-8">{children}</main>
      </div>
      <AppNav items={sim ? nav.filter((n) => n.href !== "/app/relatorios") : nav} variant="mobile" />
    </div>
  );
}
