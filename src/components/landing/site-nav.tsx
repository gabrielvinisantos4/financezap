"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoBars } from "./phone";
import { ThemeToggle } from "@/components/theme";

type NavLink = { href: string; label: string };

/**
 * Menu do site: no computador, links + Entrar + botão principal;
 * no celular, Entrar e o botão principal continuam à vista e o resto
 * vai para o menu de três riscos.
 */
export function SiteNav({ links, panelHref, cta }: { links: NavLink[]; panelHref: string | null; cta: NavLink }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const login = panelHref ? { href: panelHref, label: "Abrir painel" } : { href: "/entrar", label: "Entrar" };

  return (
    <header className="fz-nav">
      <div className="fz-nav-in glass">
        <Link href="/" className="fz-logo" aria-label="FinanceZap, página inicial">
          <span className="fz-logo-mark">
            <LogoBars />
          </span>
          <span className="fz-logo-text">FinanceZap</span>
        </Link>
        <nav aria-label="Principal">
          {links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="fz-nav-cta">
          <ThemeToggle className="fz-theme fz-nav-theme" />
          <Link href={login.href} className={`fz-pill ${panelHref ? "fz-pill-green" : "fz-pill-ghost"} fz-nav-login`}>
            {login.label}
          </Link>
          {/* Logado: o botão principal vira "Abrir painel" (não faz sentido criar outra conta) */}
          {!panelHref && (
            <Link href={cta.href} className="fz-pill fz-pill-green fz-nav-main">
              {cta.label}
            </Link>
          )}
          <button
            type="button"
            className="fz-burger"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            aria-controls="fz-menu"
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      {open && (
        <>
          <button type="button" className="fz-menu-scrim" aria-label="Fechar menu" onClick={() => setOpen(false)} />
          <div id="fz-menu" className="fz-menu glass">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            ))}
            <div className="fz-menu-row">
              <span>Tema claro ou escuro</span>
              <ThemeToggle />
            </div>
            <Link href={login.href} className="fz-pill fz-pill-ghost" onClick={() => setOpen(false)}>
              {login.label}
            </Link>
            {!panelHref && (
              <Link href={cta.href} className="fz-pill fz-pill-green" onClick={() => setOpen(false)}>
                {cta.label}
              </Link>
            )}
          </div>
        </>
      )}
    </header>
  );
}
