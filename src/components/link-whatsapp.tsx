"use client";

import { useState, useTransition } from "react";
import { createLinkCodeAction } from "@/app/actions/app";

export function LinkWhatsapp({ hasBusinessNumber }: { hasBusinessNumber: boolean }) {
  const [code, setCode] = useState<{ code: string; waLink: string | null; expiresAt: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      {!code ? (
        <button className="btn btn-coin" disabled={pending} onClick={() => start(async () => setCode(await createLinkCodeAction()))}>
          {pending ? "Gerando…" : "Gerar código de vínculo"}
        </button>
      ) : (
        <div className="grid gap-4">
          <div>
            <p className="text-sm text-ink-soft">Seu código (vale por 15 minutos e só pode ser usado uma vez):</p>
            <p className="display money mt-1 text-5xl tracking-[0.15em]">{code.code}</p>
          </div>
          {code.waLink && hasBusinessNumber ? (
            <a href={code.waLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary w-fit">
              Abrir o WhatsApp com o código
            </a>
          ) : (
            <p className="text-sm text-ink-soft">Envie a mensagem “Vincular {code.code}” para o número do FinanceZap.</p>
          )}
          <p className="text-sm text-ink-soft">Envie do número que você vai usar no dia a dia. Depois é só voltar aqui e atualizar a página.</p>
          <button className="w-fit text-sm underline" onClick={() => start(async () => setCode(await createLinkCodeAction()))}>
            Gerar outro código
          </button>
        </div>
      )}
    </div>
  );
}
