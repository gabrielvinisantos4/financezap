import { notFound } from "next/navigation";
import { env } from "@/server/config/env";
import { appContext } from "@/server/app-context";
import { PageHeader } from "@/components/ui";
import { Simulator } from "@/components/simulator";

export const metadata = { title: "Simulador" };

export default async function SimulatorPage() {
  if (!env().SIMULATOR_ENABLED) notFound();
  await appContext();
  return (
    <>
      <PageHeader title="Simulador do WhatsApp" description="Converse com o mesmo assistente que vai atender no WhatsApp. Os lançamentos são reais e aparecem no painel." />
      <Simulator />
    </>
  );
}
