import { requireAdmin } from "@/server/auth/session";
import { AppNav, type NavItem } from "@/components/app-nav";
import { Logo } from "@/components/ui";
import { logoutAction } from "@/app/actions/auth";

export const metadata = { title: { default: "Administração", template: "%s · Admin FinanceZap" }, robots: { index: false } };

const NAV: NavItem[] = [
  { href: "/admin", label: "Negócio", icon: "◎" },
  { href: "/admin/clientes", label: "Clientes", icon: "☺" },
  { href: "/admin/planos", label: "Planos", icon: "★" },
  { href: "/admin/eventos", label: "Operação", icon: "⚑" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto grid min-h-dvh max-w-7xl lg:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line px-4 py-6 lg:flex lg:flex-col">
        <Logo className="mb-2 px-3" />
        <p className="mb-8 px-3 text-xs font-semibold text-loss">Área administrativa</p>
        <AppNav items={NAV} variant="desktop" />
        <div className="mt-auto px-3 pt-6 text-sm">
          <p className="truncate font-semibold">{admin.name}</p>
          <p className="text-ink-faint">{admin.role}{admin.canViewPii ? " · dados pessoais" : ""}</p>
          <form action={logoutAction} className="mt-2"><button className="text-ink-soft hover:underline">Sair</button></form>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 pb-24 sm:px-8">{children}</main>
      <AppNav items={NAV} variant="mobile" />
    </div>
  );
}
