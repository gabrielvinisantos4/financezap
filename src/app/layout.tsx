import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BOOT } from "@/components/theme-boot";

export const metadata: Metadata = {
  title: { default: "FinanceZap — suas finanças pelo WhatsApp", template: "%s · FinanceZap" },
  description: "Registre gastos e recebimentos conversando no WhatsApp e acompanhe tudo em um painel simples.",
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f9f8" }, { media: "(prefers-color-scheme: dark)", color: "#07100c" }], width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
