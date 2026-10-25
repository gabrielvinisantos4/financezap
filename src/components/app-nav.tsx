"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string; mobile?: boolean };

export function AppNav({ items, variant }: { items: NavItem[]; variant: "desktop" | "mobile" }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/app" || href === "/admin" ? path === href : path.startsWith(href));
  if (variant === "desktop")
    return (
      <nav aria-label="Seções">
        <ul className="grid gap-1">
          {items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={isActive(i.href) ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium ${isActive(i.href) ? "bg-ink text-white" : "text-ink-soft hover:bg-surface hover:text-ink"}`}
              >
                <span aria-hidden="true" className="w-5 text-center">{i.icon}</span>
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  return (
      <nav aria-label="Seções" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="flex justify-around">
          {items
            .filter((i) => i.mobile !== false)
            .map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={isActive(i.href) ? "page" : undefined} className={`flex flex-col items-center gap-0.5 px-3 py-2 text-[0.7rem] font-semibold ${isActive(i.href) ? "text-ink" : "text-ink-faint"}`}>
                  <span aria-hidden="true" className="text-lg">{i.icon}</span>
                  {i.label}
                </Link>
              </li>
            ))}
        </ul>
      </nav>
  );
}
