"use client";

import Link from "next/link";
import { useState } from "react";

export type PricingPlan = {
  id: string;
  slug: string;
  name: string;
  description: string;
  monthly: number; // centavos
  yearly: number; // centavos
  features: string[];
  messages: number;
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function Pricing({ plans }: { plans: PricingPlan[] }) {
  const [yearly, setYearly] = useState(false);
  const saving = plans.length ? Math.round((1 - plans[0].yearly / (plans[0].monthly * 12)) * 100) : 0;
  const featured = plans.length >= 3 ? 1 : plans.length - 1;

  return (
    <>
      <div className="fz-billing" role="radiogroup" aria-label="Forma de cobrança">
        <button type="button" role="radio" aria-checked={!yearly} className={!yearly ? "is-on" : ""} onClick={() => setYearly(false)}>
          Mensal
        </button>
        <button type="button" role="radio" aria-checked={yearly} className={yearly ? "is-on" : ""} onClick={() => setYearly(true)}>
          Anual {saving > 0 && <span className="fz-save">−{saving}%</span>}
        </button>
      </div>

      <div className="fz-plans">
        {plans.map((p, i) => {
          const pro = i === featured;
          const price = yearly ? p.yearly / 12 : p.monthly;
          return (
            <article key={p.id} className={`fz-plan glass ${pro ? "is-pro" : ""}`} data-r>
              {pro && <span className="fz-badge">Mais escolhido</span>}
              <h3>{p.name}</h3>
              <p className="fz-plan-desc">{p.description || " "}</p>
              <p className="fz-plan-price">
                <strong>{brl(Math.round(price))}</strong>
                <span>/mês</span>
              </p>
              <p className="fz-plan-bill">{yearly ? `${brl(p.yearly)} cobrados por ano` : `ou ${brl(p.yearly)} por ano`}</p>
              <ul>
                {[...p.features.slice(0, 4), `Até ${p.messages.toLocaleString("pt-BR")} mensagens por mês`].map((f) => (
                  <li key={f}>
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={`/cadastro?plano=${p.slug}`} className={`fz-pill ${pro ? "fz-pill-green" : "fz-pill-soft"} fz-plan-cta`}>
                Começar agora
                {pro && <Arrow />}
              </Link>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="fz-arrow">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
