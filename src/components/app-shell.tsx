import { AppNav, type NavItem } from "@/components/app-nav";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";
import { logoutAction } from "@/app/actions/auth";

/** Moldura do sistema: menu lateral de vidro no computador, barra flutuante no celular. */
export function AppShell({
  nav,
  mobileNav,
  home,
  name,
  detail,
  tag,
  banners,
  children,
}: {
  nav: NavItem[];
  mobileNav?: NavItem[];
  home: string;
  name: string;
  detail: string;
  tag?: string;
  banners?: React.ReactNode;
  children: React.ReactNode;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "F";
  return (
    <div className="mx-auto grid min-h-dvh max-w-[1440px] lg:grid-cols-[264px_1fr] lg:gap-2 lg:p-3">
      <aside className="glass sticky top-3 hidden h-[calc(100dvh-24px)] flex-col rounded-[28px] px-3 py-5 lg:flex">
        <div className="mb-2 flex items-center justify-between px-2.5">
          <Logo href={home} />
          <ThemeToggle className="theme-btn" />
        </div>
        {tag && <p className="mb-2 px-3 text-xs font-semibold text-coin">{tag}</p>}
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <AppNav items={nav} variant="desktop" />
        </div>
        <div className="card mt-4 flex items-center gap-3 rounded-[20px] p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gain-soft font-bold text-gain">{initial}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-ink-faint">{detail}</p>
          </div>
          <form action={logoutAction}>
            <button className="lg-ghost grid h-9 w-9 place-items-center rounded-full text-ink-faint hover:text-loss" aria-label="Sair" title="Sair">
              <Icon name="logout" size={18} />
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 pb-28 lg:pb-8">
        <div className="sticky top-0 z-20 px-3 pt-3 lg:hidden">
          <div className="glass flex h-14 items-center justify-between rounded-full pl-4 pr-2">
            <Logo href={home} />
            <div className="flex items-center gap-1.5">
              <ThemeToggle className="theme-btn" />
              <form action={logoutAction}>
                <button className="theme-btn" aria-label="Sair" title="Sair">
                  <Icon name="logout" size={18} />
                </button>
              </form>
            </div>
          </div>
        </div>
        {banners && <div className="grid gap-3 px-4 pt-4 sm:px-8 lg:pt-6">{banners}</div>}
        <main className="px-4 py-6 sm:px-8 lg:py-8">{children}</main>
      </div>
      <AppNav items={mobileNav ?? nav} variant="mobile" />
    </div>
  );
}
