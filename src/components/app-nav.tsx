"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
                    on ? "lg-tint font-semibold text-gain" : "lg-ghost text-ink-soft hover:text-ink"
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
  return <MobileNav items={items} isActive={isActive} path={path} />;
}

/** Barra flutuante do celular: os atalhos principais e "Mais" com todas as seções. */
function MobileNav({ items, isActive, path }: { items: NavItem[]; isActive: (href: string) => boolean; path: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const main = items.filter((i) => i.mobile !== false);
  const rest = items.filter((i) => i.mobile === false);
  const restActive = rest.some((i) => isActive(i.href));
  const cell = (on: boolean) => `flex flex-col items-center gap-0.5 rounded-[18px] px-1 py-1.5 text-[0.68rem] font-semibold transition-colors ${on ? "lg-tint text-gain" : "text-ink-faint"}`;
  return (
    <>
      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} />}
      <nav aria-label="Seções" className="fixed inset-x-3 bottom-3 z-40 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {open && (
          <ul id="mais-secoes" className="glass mb-2 grid grid-cols-2 gap-1 rounded-[24px] p-2">
            {rest.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={isActive(i.href) ? "page" : undefined}
                  className={`flex h-12 items-center gap-2.5 rounded-[16px] px-3 text-sm font-semibold ${isActive(i.href) ? "lg-tint text-gain" : "text-ink-soft"}`}
                >
                  <Icon name={i.icon} size={19} />
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <ul className="glass flex justify-around rounded-[26px] px-1 py-1.5">
          {main.map((i) => (
            <li key={i.href} className="flex-1">
              <Link href={i.href} aria-current={isActive(i.href) ? "page" : undefined} className={cell(isActive(i.href))}>
                <Icon name={i.icon} size={20} />
                {i.label}
              </Link>
            </li>
          ))}
          {rest.length > 0 && (
            <li className="flex-1">
              <button type="button" aria-expanded={open} aria-controls="mais-secoes" onClick={() => setOpen((o) => !o)} className={`w-full ${cell(open || restActive)}`}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                  <circle cx="5.5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="18.5" cy="12" r="1.8" />
                </svg>
                Mais
              </button>
            </li>
          )}
        </ul>
      </nav>
    </>
  );
}
