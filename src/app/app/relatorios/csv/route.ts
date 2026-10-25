import { currentUser } from "@/server/auth/session";
import { withUser } from "@/server/db/client";
import { listTransactions } from "@/server/finance/queries";
import { todayIn } from "@/server/finance/dates";
import { monthFromParam } from "@/server/app-context";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { income: "Receita", expense: "Despesa", transfer: "Transferência", card_payment: "Pagamento de fatura", refund: "Estorno" };

function cell(v: string | number | null | undefined) {
  const s = String(v ?? "");
  // Evita injeção de fórmulas ao abrir no Excel/Sheets
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("não autenticado", { status: 401 });
  const period = monthFromParam(new URL(req.url).searchParams.get("mes") ?? undefined, todayIn(user.timezone));
  const rows = await withUser(user.id, (tx) => listTransactions(tx, user.id, { period, limit: 500 }));
  const header = ["Data", "Tipo", "Descrição", "Estabelecimento/Cliente", "Categoria", "Conta", "Valor (R$)", "Situação"];
  const lines = rows.map((t) =>
    [t.occurredOn, KIND[t.kind], t.description, t.merchant ?? t.counterparty, t.categoryName, t.accountName, ((t.kind === "expense" || t.kind === "transfer" || t.kind === "card_payment" ? -1 : 1) * t.amountCents / 100).toFixed(2).replace(".", ","), t.status === "pending" ? "Pendente" : "Pago"]
      .map(cell)
      .join(";"),
  );
  const csv = "﻿" + [header.map(cell).join(";"), ...lines].join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="financezap-${period.key}.csv"`, "Cache-Control": "no-store" },
  });
}
