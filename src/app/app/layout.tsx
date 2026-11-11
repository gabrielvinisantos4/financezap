import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getEntitlement } from "@/server/billing/entitlements";
import { getLinkedNumber } from "@/server/whatsapp/linking";
import type { NavItem } from "@/components/app-nav";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { env } from "@/server/config/env";

const NAV: NavItem[] = [
  { href: "/app", label: "Visão geral", icon: "home" },
  { href: "/app/lancamentos", label: "Lançamentos", icon: "swap" },
  { href: "/app/whatsapp", label: "WhatsApp", icon: "chat" },
  { href: "/app/limites", label: "Limites", icon: "gauge" },
  { href: "/app/contas", label: "Contas", icon: "card", mobile: false },
  { href: "/app/relatorios", label: "Relatórios", icon: "bars", mobile: false },
  { href: "/app/categorias", label: "Categorias", icon: "tag", mobile: false },
  { href: "/app/assinatura", label: "Assinatura", icon: "star", mobile: false },
  { href: "/app/afiliados", label: "Afiliados", icon: "users", mobile: false },
  { href: "/app/conta", label: "Conta", icon: "user", mobile: false },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [ent, linked] = await Promise.all([getEntitlement(user.id), getLinkedNumber(user.id)]);
  const sim = env().SIMULATOR_ENABLED;
  const nav: NavItem[] = sim ? [NAV[0], { href: "/app/simulador", label: "Simulador", icon: "msg", mobile: false }, ...NAV.slice(1)] : NAV;

  const banners = (
    <>
      {!ent.active && (
        <Notice>
          {ent.reason === "pending_payment"
            ? "Estamos aguardando a confirmação do pagamento. O WhatsApp é liberado assim que o pagamento for confirmado."
            : ent.reason === "blocked"
              ? "Seu acesso está suspenso. Entre em contato com o suporte."
              : "Sua assinatura não está ativa, então o assistente no WhatsApp está pausado."}{" "}
          {ent.reason !== "blocked" && (
            <Link href="/app/assinatura" className="font-semibold text-gain underline-offset-2 hover:underline">
              Ver assinatura
            </Link>
          )}
        </Notice>
      )}
      {ent.active && !linked && (
        <Notice>
          Falta um passo:{" "}
          <Link href="/app/whatsapp" className="font-semibold text-gain underline-offset-2 hover:underline">
            vincule seu WhatsApp
          </Link>{" "}
          para começar a registrar pela conversa.
        </Notice>
      )}
    </>
  );
  const hasBanner = !ent.active || (ent.active && !linked);

  return (
    <AppShell nav={nav} home="/app" name={user.name} detail={user.email} banners={hasBanner ? banners : undefined}>
      {children}
    </AppShell>
  );
}
