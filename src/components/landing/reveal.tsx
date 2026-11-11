"use client";

import { useEffect } from "react";

/**
 * Entradas por seção: cada [data-reveal] ganha .is-in quando entra na tela, e seus filhos
 * [data-r] chegam em ordem (o atraso vem do CSS via --i). Sem JS, nada fica escondido:
 * o estado escondido só existe sob html.js.
 */
export function Reveal() {
  useEffect(() => {
    document.documentElement.classList.add("js");
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    els.forEach((el) => el.querySelectorAll<HTMLElement>("[data-r]").forEach((c, i) => c.style.setProperty("--i", String(i))));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
