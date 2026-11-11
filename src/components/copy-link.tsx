"use client";

import { useState } from "react";

/** Link de indicação com botões de copiar e compartilhar no WhatsApp. */
export function CopyLink({ url, shareText }: { url: string; shareText: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex min-w-0 items-center gap-2 rounded-[16px] border border-line bg-paper px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-semibold" title={url}>
          {url}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              window.prompt("Copie o link:", url);
            }
          }}
        >
          {copied ? "Link copiado!" : "Copiar link"}
        </button>
        <a className="btn lg-btn" href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`} target="_blank" rel="noopener noreferrer">
          Enviar no WhatsApp
        </a>
      </div>
    </div>
  );
}
