import { requireAdmin } from "@/server/auth/session";
import type { NavItem } from "@/components/app-nav";
import { AppShell } from "@/components/app-shell";

export const metadata = { title: { default: "Administração", template: "%s · Admin FinanceZap" }, robots: { index: false } };

const NAV: NavItem[] = [
  { href: "/admin", label: "Negócio", icon: "bars" },
  { href: "/admin/clientes", label: "Clientes", icon: "users" },
  { href: "/admin/planos", label: "Planos", icon: "star" },
  { href: "/admin/eventos", label: "Operação", icon: "pulse" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <AppShell nav={NAV} home="/admin" name={admin.name} detail={`${admin.role}${admin.canViewPii ? " · dados pessoais" : ""}`} tag="Área administrativa">
      {children}
    </AppShell>
  );
}
