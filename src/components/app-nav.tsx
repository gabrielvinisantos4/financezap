"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

export type NavItem = { href: string; label: string; icon: IconName; mobile?: boolean };

export function AppNav({ items, variant }: { items: NavItem[]; variant: "desktop" | "mobile" }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/app" || href === "/admin" ? path === href : path.startsWith(href));
  if (variant === "desktop")
    return (
      <nav aria-label="Seções">
        <ul className="grid gap-1">
          {items.map((i) => {
            const on = isActive(i.href);
            return (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-11 items-center gap-3 rounded-[14px] px-3.5 text-[0.93rem] font-medium transition-colors ${
                    on ? "bg-gain-soft font-semibold text-gain" : "text-ink-soft hover:bg-surface hover:text-ink"
                  }`}
                >
                  <Icon name={i.icon} />
                  {i.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  return (
    <nav aria-label="Seções" className="fixed inset-x-3 bottom-3 z-30 pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="glass flex justify-around rounded-[26px] px-1 py-1.5">
        {items
          .filter((i) => i.mobile !== false)
          .map((i) => {
            const on = isActive(i.href);
            return (
              <li key={i.href} className="flex-1">
                <Link
                  href={i.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 rounded-[18px] px-1 py-1.5 text-[0.68rem] font-semibold transition-colors ${on ? "bg-gain-soft text-gain" : "text-ink-faint"}`}
                >
                  <Icon name={i.icon} size={20} />
                  {i.label}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
