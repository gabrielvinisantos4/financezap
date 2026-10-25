import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FinanceZap — suas finanças pelo WhatsApp", template: "%s · FinanceZap" },
  description: "Registre gastos e recebimentos conversando no WhatsApp e acompanhe tudo em um painel simples.",
};

export const viewport: Viewport = { themeColor: "#1b2a4a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
