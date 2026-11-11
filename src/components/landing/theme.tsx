"use client";

/** Alterna claro/escuro na página de vendas e lembra a escolha neste navegador. */
export function ThemeToggle() {
  function toggle() {
    const root = document.querySelector<HTMLElement>(".fz");
    if (!root) return;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("fz-theme", next);
    } catch {}
  }
  return (
    <button type="button" className="fz-theme" onClick={toggle} aria-label="Alternar tema claro ou escuro" title="Tema claro ou escuro">
      <svg className="is-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
      <svg className="is-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </svg>
    </button>
  );
}

/** Roda antes da pintura: escolha salva, senão o tema do aparelho. */
export const THEME_BOOT = `(function(){try{var r=document.currentScript.parentElement;var t=localStorage.getItem("fz-theme");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}r.dataset.theme=t}catch(e){}})();`;
