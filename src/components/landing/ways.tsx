"use client";

import { useState } from "react";
import { Phone, type Scene } from "./phone";

const WAYS: { id: Scene; title: string; text: string; icon: React.ReactNode }[] = [
  {
    id: "escrever",
    title: "Digite",
    text: "“Gastei 85 no mercado.”",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="3" />
        <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
      </svg>
    ),
  },
  {
    id: "falar",
    title: "Fale",
    text: "Mande um áudio dizendo o gasto.",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    ),
  },
  {
    id: "encaminhar",
    title: "Envie",
    text: "Encaminhe o comprovante do Pix ou a nota.",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m20 11-8.2 8.2a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4L14.5 7" />
      </svg>
    ),
  },
];

export function Ways() {
  const [scene, setScene] = useState<Scene>("escrever");
  return (
    <div className="fz-ways">
      <div className="fz-ways-list" role="tablist" aria-label="Jeitos de registrar um gasto">
        {WAYS.map((w) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={scene === w.id}
            className={`fz-way glass ${scene === w.id ? "is-on" : ""}`}
            onClick={() => setScene(w.id)}
            onMouseEnter={() => setScene(w.id)}
          >
            <span className="fz-way-icon">{w.icon}</span>
            <span>
              <strong>{w.title}</strong>
              <span>{w.text}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="fz-ways-phone">
        <Phone scene={scene} size="md" />
      </div>
    </div>
  );
}
