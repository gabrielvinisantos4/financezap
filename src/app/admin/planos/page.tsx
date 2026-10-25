import { requireAdmin } from "@/server/auth/session";
import { listAllPlans } from "@/server/admin/admin";
import { formatBRL } from "@/server/finance/money";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { savePlanAction } from "@/app/actions/admin";
import type { Plan } from "@/server/db/schema";

export const metadata = { title: "Planos" };
export const dynamic = "force-dynamic";

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

function PlanForm({ plan }: { plan?: Plan }) {
  return (
    <ActionForm action={savePlanAction} className="grid gap-3">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field"><span>Nome</span><input className="input" name="name" defaultValue={plan?.name} required /></label>
        <label className="field"><span>Identificador</span><input className="input" name="slug" defaultValue={plan?.slug} required /></label>
        <label className="field"><span>Ordem</span><input className="input" name="sortOrder" type="number" defaultValue={plan?.sortOrder ?? 0} /></label>
      </div>
      <label className="field"><span>Descrição</span><input className="input" name="description" defaultValue={plan?.description} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field"><span>Preço mensal (R$)</span><input className="input money" name="priceMonthly" defaultValue={plan ? reais(plan.priceMonthlyCents) : ""} inputMode="decimal" /></label>
        <label className="field"><span>Preço anual (R$)</span><input className="input money" name="priceYearly" defaultValue={plan ? reais(plan.priceYearlyCents) : ""} inputMode="decimal" /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field"><span>Mensagens/mês</span><input className="input" name="monthlyMessages" type="number" min={1} defaultValue={plan?.limits.monthlyMessages ?? 300} /></label>
        <label className="field"><span>Chamadas de IA/mês</span><input className="input" name="monthlyAiCalls" type="number" min={0} defaultValue={plan?.limits.monthlyAiCalls ?? 300} /></label>
        <label className="field"><span>Máx. contas</span><input className="input" name="maxAccounts" type="number" min={1} defaultValue={plan?.limits.maxAccounts ?? 3} /></label>
      </div>
      <label className="field"><span>Benefícios (um por linha, aparecem na página de vendas)</span><textarea className="input" name="features" rows={4} defaultValue={plan?.features.join("\n")} /></label>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="customCategories" defaultChecked={plan?.limits.customCategories} className="h-4 w-4" />Categorias personalizadas</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="advancedReports" defaultChecked={plan?.limits.advancedReports} className="h-4 w-4" />Relatórios avançados</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={plan?.active} className="h-4 w-4" />Disponível para venda</label>
      </div>
      <Submit className="btn btn-primary w-fit">{plan ? "Salvar plano" : "Criar plano"}</Submit>
    </ActionForm>
  );
}

export default async function Plans() {
  await requireAdmin("manage_plans");
  const plans = await listAllPlans();
  return (
    <>
      <PageHeader title="Planos" description="Mudanças de preço valem para novas assinaturas; quem já assina mantém o valor contratado. Antes de ativar, confira o custo por cliente em docs/CUSTOS.md." />
      <div className="grid gap-6">
        {plans.map((p) => (
          <Panel key={p.id} title={`${p.name} · ${formatBRL(p.priceMonthlyCents)}/mês`} action={<Badge tone={p.active ? "gain" : "neutral"}>{p.active ? "À venda" : "Inativo"}</Badge>}>
            <PlanForm plan={p} />
          </Panel>
        ))}
        <Panel title="Novo plano">
          <PlanForm />
        </Panel>
      </div>
    </>
  );
}
